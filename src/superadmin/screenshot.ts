/** Native builds cannot take a picture of the app: the server then draws a snapshot of the data instead (see server/backup/preview.js). */
export async function captureApp(): Promise<string | null> {
  return null;
}
