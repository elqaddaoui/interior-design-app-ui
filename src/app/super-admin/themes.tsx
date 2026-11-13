import { Redirect } from 'expo-router';

/** "Clone Existing Store" is no longer a page: it is a button next to "New demo" in Demos. Old links and bookmarks land there. */
export default function Themes() {
  return <Redirect href="/super-admin/demos?clone=1" />;
}
