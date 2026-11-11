/**
 * Babel plugin: replaces `process.env.EXPO_BASE_URL` (what expo-router prefixes every link with and strips from every incoming URL)
 * with the tenant slug the HTML shell put on `window.__DWIRA_BASE__`. The base is therefore decided when the page loads, so ONE static
 * build serves app.com/acme, app.com/globex and a custom domain. Native has no `window`: the value is '' there.
 * expo-router only applies it when NODE_ENV !== 'development', so the Metro dev server keeps working at the root.
 */
const RUNTIME = "(typeof window!=='undefined'&&window.__DWIRA_BASE__||'')";
module.exports = function tenantBase({ types: t, template }) {
  const expression = template.expression(RUNTIME, { placeholderPattern: false });
  return {
    name: 'dwira-tenant-base',
    visitor: {
      MemberExpression(path) {
        if (!path.matchesPattern('process.env.EXPO_BASE_URL')) return;
        // `process.env.EXPO_BASE_URL = x` is never written by the app; only read positions are replaced.
        if (t.isAssignmentExpression(path.parent) && path.parent.left === path.node) return;
        path.replaceWith(expression());
      },
    },
  };
};
module.exports.RUNTIME = RUNTIME;
