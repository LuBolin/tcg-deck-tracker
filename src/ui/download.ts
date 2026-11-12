/** Save text as a file through a temporary link (no server involved). */
export function downloadText(filename: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[\\/:*?"<>|]/g, '_'); // characters Windows forbids in file names
  a.click();
  URL.revokeObjectURL(url);
}
