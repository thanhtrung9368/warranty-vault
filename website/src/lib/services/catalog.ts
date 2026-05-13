import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/prisma';

export type CategoryOption = {
  code: string;
  name: string;
};

export type BrandOption = {
  id: string;
  name: string;
  categoryCodes: string[]; // empty array = global brand
};

export type StoreOption = {
  id: string;
  name: string;
  type: string;
};

export type WarrantyProviderOption = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  websiteUrl: string | null;
  notes: string | null;
};

export const getCategories = unstable_cache(
  async (): Promise<CategoryOption[]> => {
    const rows = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { code: true, name: true },
    });
    return rows;
  },
  ['catalog:categories'],
  { revalidate: 3600, tags: ['catalog'] },
);

export const getBrands = unstable_cache(
  async (): Promise<BrandOption[]> => {
    const rows = await prisma.brand.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        categories: { select: { categoryCode: true } },
      },
    });
    return rows.map((b) => ({
      id: b.id,
      name: b.name,
      categoryCodes: b.categories.map((c) => c.categoryCode),
    }));
  },
  ['catalog:brands'],
  { revalidate: 3600, tags: ['catalog'] },
);

export const getStores = unstable_cache(
  async (): Promise<StoreOption[]> => {
    const rows = await prisma.store.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, type: true },
    });
    return rows;
  },
  ['catalog:stores'],
  { revalidate: 3600, tags: ['catalog'] },
);

export const getWarrantyProviders = unstable_cache(
  async (): Promise<WarrantyProviderOption[]> => {
    const rows = await prisma.warrantyProvider.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        phone: true,
        address: true,
        websiteUrl: true,
        notes: true,
      },
    });
    return rows;
  },
  ['catalog:warranty-providers'],
  { revalidate: 3600, tags: ['catalog'] },
);

export async function getDeviceFormCatalog() {
  const [categories, brands, stores, warrantyProviders] = await Promise.all([
    getCategories(),
    getBrands(),
    getStores(),
    getWarrantyProviders(),
  ]);
  return { categories, brands, stores, warrantyProviders };
}
