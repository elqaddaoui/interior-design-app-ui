/** `/super-admin` and everything below it. Plain string logic: safe to import from the root layout without pulling any tenant code. */
export const isSuperAdminPath = (path: string) => path === '/super-admin' || path.startsWith('/super-admin/');
