// Single entry point for web → Go REST client. Every server action /
// page/component imports from here:
//
//     import { api } from '@/lib/api';
//     const res = await api.auth.login(email, password);
//
// Resource sub-modules are owned by separate parallel agents — keep the
// AGENT markers below so each agent can append re-exports without merge
// conflicts.

import * as authApi from './auth';
// AGENT_B_IMPORTS_BEGIN
import * as devicesApi from './devices';
import * as warrantiesApi from './warranties';
import * as attachmentsApi from './attachments';
import * as remindersApi from './reminders';
// AGENT_B_IMPORTS_END
// AGENT_C_IMPORTS_BEGIN
import * as subscriptionsApi from './subscriptions';
import * as wishlistApi from './wishlist';
import * as catalogApi from './catalog';
import * as pushApi from './push';
import * as statsApi from './stats';
// AGENT_C_IMPORTS_END

export const api = {
  auth: authApi,
  // AGENT_B_NAMESPACES_BEGIN
  devices: devicesApi,
  warranties: warrantiesApi,
  attachments: attachmentsApi,
  reminders: remindersApi,
  // AGENT_B_NAMESPACES_END
  // AGENT_C_NAMESPACES_BEGIN
  subscriptions: subscriptionsApi,
  wishlist: wishlistApi,
  catalog: catalogApi,
  push: pushApi,
  stats: statsApi,
  // AGENT_C_NAMESPACES_END
};

export type { ApiResult, ApiError, ApiSuccess, FormState } from './client';
export { toFormState, apiFetch } from './client';
