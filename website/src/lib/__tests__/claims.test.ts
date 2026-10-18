import { describe, expect, it } from 'vitest';
import {
  CLAIM_COVERAGE_LABELS,
  CLAIM_STATUSES,
  CLAIM_STATUS_LABELS,
  brokenDevicesWithoutOpenClaim,
  claimAnchorId,
  claimCoverageLabel,
  claimCoverageValue,
  claimIsClosed,
  claimIsOpen,
  claimStatusLabel,
  claimStatusTransition,
  closedClaims,
  coveredByWarrantyFromInput,
  findOpenClaimForDevice,
  formatClaimCost,
  isClaimLimitReached,
  isClaimStatus,
  isClosedClaimStatus,
  isOpenClaimStatus,
  openClaimHref,
  openClaims,
  parseClaimCost,
  sortClaimsForDisplay,
} from '@/lib/claims';

// Warranty claims / repair cases are built against a frozen contract while the
// Go implementation lands in parallel. These tests pin only the web's pure
// half: the status vocabulary and its open/closed partition, the tri-state
// coverage answer, money parsing/formatting, the 409 code mapping, and the two
// selectors the UI depends on (the open case for a device, and "broken with no
// case" for the nudge).
//
// Nothing here calls the API: no request can exist while the server does not.

describe('status vocabulary', () => {
  it('ships exactly the five statuses in the contract', () => {
    expect([...CLAIM_STATUSES]).toEqual([
      'OPEN',
      'IN_REPAIR',
      'RESOLVED',
      'REJECTED',
      'CANCELLED',
    ]);
  });

  it('has a registered label for every status', () => {
    for (const status of CLAIM_STATUSES) {
      expect(CLAIM_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it('renders labels in both languages', () => {
    expect(claimStatusLabel('OPEN', 'en')).toBe('Open');
    expect(claimStatusLabel('IN_REPAIR', 'en')).toBe('In repair');
    expect(claimStatusLabel('RESOLVED', 'en')).toBe('Resolved');
    expect(claimStatusLabel('REJECTED', 'en')).toBe('Rejected');
    expect(claimStatusLabel('CANCELLED', 'en')).toBe('Cancelled');
    expect(claimStatusLabel('OPEN', 'vi')).toBe('Đang mở');
  });

  it('falls back to the code for a status a newer server added', () => {
    expect(claimStatusLabel('WAITING_PARTS', 'en')).toBe('WAITING_PARTS');
    expect(claimStatusLabel('WAITING_PARTS', 'vi')).toBe('WAITING_PARTS');
  });

  it('recognises only the five known statuses', () => {
    for (const status of CLAIM_STATUSES) expect(isClaimStatus(status)).toBe(true);
    expect(isClaimStatus('waiting_parts')).toBe(false);
    expect(isClaimStatus(undefined)).toBe(false);
  });
});

describe('open vs closed derivation', () => {
  it('treats OPEN and IN_REPAIR as open, and the rest as closed', () => {
    expect(isOpenClaimStatus('OPEN')).toBe(true);
    expect(isOpenClaimStatus('IN_REPAIR')).toBe(true);
    expect(isOpenClaimStatus('RESOLVED')).toBe(false);
    expect(isClosedClaimStatus('RESOLVED')).toBe(true);
    expect(isClosedClaimStatus('REJECTED')).toBe(true);
    expect(isClosedClaimStatus('CANCELLED')).toBe(true);
    expect(isClosedClaimStatus('OPEN')).toBe(false);
  });

  it('treats an unknown status as neither open nor closed', () => {
    expect(isOpenClaimStatus('WAITING_PARTS')).toBe(false);
    expect(isClosedClaimStatus('WAITING_PARTS')).toBe(false);
  });

  it('classifies status changes without forbidding any of them', () => {
    expect(claimStatusTransition('OPEN', 'OPEN')).toBe('same');
    expect(claimStatusTransition('OPEN', 'IN_REPAIR')).toBe('advance');
    expect(claimStatusTransition('IN_REPAIR', 'OPEN')).toBe('advance');
    expect(claimStatusTransition('OPEN', 'RESOLVED')).toBe('close');
    expect(claimStatusTransition('IN_REPAIR', 'REJECTED')).toBe('close');
    expect(claimStatusTransition('RESOLVED', 'OPEN')).toBe('reopen');
    expect(claimStatusTransition('CANCELLED', 'IN_REPAIR')).toBe('reopen');
    // Correcting a closed outcome without reopening is still allowed by the
    // API, so the client must not hide it.
    expect(claimStatusTransition('RESOLVED', 'REJECTED')).toBe('correct');
  });

  it('derives open/closed from status, not from closedAt', () => {
    // The server owns closedAt; a stale or inconsistent value must not
    // re-classify a case the status says is still open.
    expect(claimIsOpen({ status: 'IN_REPAIR' })).toBe(true);
    expect(claimIsClosed({ status: 'IN_REPAIR' })).toBe(false);
    expect(claimIsClosed({ status: 'RESOLVED' })).toBe(true);
    expect(claimIsOpen({ status: 'RESOLVED' })).toBe(false);
  });

  it('partitions a list and drops unknown statuses from both halves', () => {
    const claims = [
      { id: 'a', status: 'OPEN' },
      { id: 'b', status: 'RESOLVED' },
      { id: 'c', status: 'IN_REPAIR' },
      { id: 'd', status: 'WAITING_PARTS' },
    ];
    expect(openClaims(claims).map((c) => c.id)).toEqual(['a', 'c']);
    expect(closedClaims(claims).map((c) => c.id)).toEqual(['b']);
  });
});

describe('findOpenClaimForDevice', () => {
  const claims = [
    { id: 'old', deviceId: 'd1', status: 'RESOLVED' },
    { id: 'open-other', deviceId: 'd2', status: 'OPEN' },
    { id: 'open', deviceId: 'd1', status: 'IN_REPAIR' },
  ];

  it('returns the device\'s open case and ignores closed history', () => {
    expect(findOpenClaimForDevice(claims, 'd1')?.id).toBe('open');
  });

  it('returns null when the device has only closed history', () => {
    expect(findOpenClaimForDevice([claims[0]], 'd1')).toBeNull();
  });

  it('does not borrow another device\'s open case', () => {
    expect(findOpenClaimForDevice(claims, 'd3')).toBeNull();
  });
});

describe('sortClaimsForDisplay', () => {
  it('puts open cases first, then the newest openedAt', () => {
    const claims = [
      { id: 'closed-new', status: 'RESOLVED', openedAt: '2026-09-01T00:00:00' },
      { id: 'open-old', status: 'OPEN', openedAt: '2026-01-01T00:00:00' },
      { id: 'open-new', status: 'IN_REPAIR', openedAt: '2026-08-01T00:00:00' },
      { id: 'closed-old', status: 'CANCELLED', openedAt: '2025-01-01T00:00:00' },
    ];
    expect(sortClaimsForDisplay(claims).map((c) => c.id)).toEqual([
      'open-new',
      'open-old',
      'closed-new',
      'closed-old',
    ]);
  });

  it('does not mutate the server payload', () => {
    const claims = [
      { id: 'closed', status: 'RESOLVED', openedAt: '2026-01-01T00:00:00' },
      { id: 'open', status: 'OPEN', openedAt: '2026-01-01T00:00:00' },
    ];
    const before = claims.map((c) => c.id);
    sortClaimsForDisplay(claims);
    expect(claims.map((c) => c.id)).toEqual(before);
  });
});

describe('broken with no open claim', () => {
  const devices = [
    { id: 'd1', name: 'Phone', status: 'BROKEN' },
    { id: 'd2', name: 'Laptop', status: 'ACTIVE' },
    { id: 'd3', name: 'Tablet', status: 'BROKEN' },
    { id: 'd4', name: 'Watch', status: 'BROKEN' },
    { id: 'd5', name: 'TV', status: 'LOST' },
  ];

  it('returns BROKEN devices with no open case, preserving order', () => {
    const claims = [
      { deviceId: 'd1', status: 'OPEN' },
      { deviceId: 'd3', status: 'RESOLVED' },
    ];
    expect(brokenDevicesWithoutOpenClaim(devices, claims).map((d) => d.id)).toEqual([
      'd3',
      'd4',
    ]);
  });

  it('counts both OPEN and IN_REPAIR as an open case', () => {
    const claims = [
      { deviceId: 'd1', status: 'IN_REPAIR' },
      { deviceId: 'd3', status: 'OPEN' },
      { deviceId: 'd4', status: 'IN_REPAIR' },
    ];
    expect(brokenDevicesWithoutOpenClaim(devices, claims)).toEqual([]);
  });

  it('still nudges when the only history is closed', () => {
    const claims = [
      { deviceId: 'd1', status: 'REJECTED' },
      { deviceId: 'd3', status: 'CANCELLED' },
      { deviceId: 'd4', status: 'RESOLVED' },
    ];
    expect(brokenDevicesWithoutOpenClaim(devices, claims).map((d) => d.id)).toEqual([
      'd1',
      'd3',
      'd4',
    ]);
  });

  it('ignores claims for other devices and non-BROKEN devices', () => {
    const claims = [{ deviceId: 'd2', status: 'OPEN' }];
    expect(brokenDevicesWithoutOpenClaim(devices, claims).map((d) => d.id)).toEqual([
      'd1',
      'd3',
      'd4',
    ]);
  });

  it('returns nothing when every broken device has an open case', () => {
    const claims = devices.map((d) => ({ deviceId: d.id, status: 'OPEN' }));
    expect(brokenDevicesWithoutOpenClaim(devices, claims)).toEqual([]);
  });
});

describe('tri-state coverage', () => {
  it('maps true / false / null to three distinct answers', () => {
    expect(claimCoverageValue(true)).toBe('covered');
    expect(claimCoverageValue(false)).toBe('notCovered');
    expect(claimCoverageValue(null)).toBe('unknown');
    expect(claimCoverageValue(undefined)).toBe('unknown');
  });

  it('renders all three in both languages', () => {
    expect(claimCoverageLabel(true, 'en')).toBe('Covered by warranty');
    expect(claimCoverageLabel(false, 'en')).toBe('Not covered by warranty');
    expect(claimCoverageLabel(null, 'en')).toBe('Not sure yet');
    expect(claimCoverageLabel(true, 'vi')).toBe('Có bảo hành');
    expect(claimCoverageLabel(false, 'vi')).toBe('Không được bảo hành');
  });

  it('has a registered label for every coverage value', () => {
    for (const label of Object.values(CLAIM_COVERAGE_LABELS)) {
      expect(label).toBeTruthy();
    }
  });

  it('parses the tri-state select without collapsing unset to false', () => {
    expect(coveredByWarrantyFromInput('true')).toBe(true);
    expect(coveredByWarrantyFromInput('false')).toBe(false);
    expect(coveredByWarrantyFromInput('unset')).toBeNull();
    expect(coveredByWarrantyFromInput('')).toBeNull();
    expect(coveredByWarrantyFromInput(null)).toBeNull();
    expect(coveredByWarrantyFromInput(undefined)).toBeNull();
    expect(coveredByWarrantyFromInput('1')).toBeNull();
  });
});

describe('cost formatting', () => {
  it('renders null as "not recorded", never as 0 ₫', () => {
    expect(formatClaimCost(null, 'en')).toBeNull();
    expect(formatClaimCost(undefined, 'en')).toBeNull();
    expect(formatClaimCost(Number.NaN, 'en')).toBeNull();
  });

  it('renders a recorded zero as a real amount', () => {
    expect(formatClaimCost(0, 'en')).toBe('₫0');
    expect(formatClaimCost(0, 'vi')).toBe('0\u00A0₫');
  });

  it('formats VND in the active language', () => {
    expect(formatClaimCost(1_500_000, 'en')).toBe('₫1,500,000');
    expect(formatClaimCost(1_500_000, 'vi')).toBe('1.500.000\u00A0₫');
  });
});

describe('parseClaimCost', () => {
  it('treats blank and absent as not recorded', () => {
    expect(parseClaimCost(undefined)).toEqual({ ok: true, cost: null });
    expect(parseClaimCost(null)).toEqual({ ok: true, cost: null });
    expect(parseClaimCost('')).toEqual({ ok: true, cost: null });
    expect(parseClaimCost('   ')).toEqual({ ok: true, cost: null });
  });

  it('keeps a real zero', () => {
    expect(parseClaimCost('0')).toEqual({ ok: true, cost: 0 });
    expect(parseClaimCost(0)).toEqual({ ok: true, cost: 0 });
  });

  it('accepts a non-negative integer from the form or the wire', () => {
    expect(parseClaimCost('1500000')).toEqual({ ok: true, cost: 1_500_000 });
    expect(parseClaimCost(250_000)).toEqual({ ok: true, cost: 250_000 });
  });

  it('refuses negative, fractional and non-numeric values', () => {
    for (const raw of ['-1', -1, '1.5', 1.5, 'abc', 'NaN', Number.POSITIVE_INFINITY, {}]) {
      const parsed = parseClaimCost(raw);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.messageKey).toBe('Chi phí phải là số nguyên không âm.');
      }
    }
  });
});

describe('409 limit_reached mapping', () => {
  it('recognises the contract code case-insensitively', () => {
    expect(isClaimLimitReached({ status: 409, error: 'limit_reached' })).toBe(true);
    expect(isClaimLimitReached({ status: 409, error: 'LIMIT_REACHED' })).toBe(true);
    expect(isClaimLimitReached({ status: 409, error: ' Limit_Reached ' })).toBe(true);
  });

  it('does not misreport another 409 or a non-409', () => {
    expect(isClaimLimitReached({ status: 409, error: 'conflict' })).toBe(false);
    expect(isClaimLimitReached({ status: 400, error: 'limit_reached' })).toBe(false);
    expect(isClaimLimitReached({ status: 409, error: '' })).toBe(false);
    expect(isClaimLimitReached({ status: 409 })).toBe(false);
  });
});

describe('claim links', () => {
  it('builds the row anchor used by the 409 link', () => {
    expect(claimAnchorId('c1')).toBe('claim-c1');
  });

  it('links straight to the open case when its id is known', () => {
    expect(openClaimHref('d1', 'c1')).toBe('/devices/d1#claim-c1');
  });

  it('falls back to the claims card when the id is unknown', () => {
    expect(openClaimHref('d1', null)).toBe('/devices/d1#claims');
    expect(openClaimHref('d1')).toBe('/devices/d1#claims');
  });
});
