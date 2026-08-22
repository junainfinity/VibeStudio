/** Client-side file download without any server round-trip. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Revoke on a later tick: some browsers dereference the URL asynchronously
  // when the download task starts, and a synchronous revoke can abort it.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadText(filename: string, text: string, type = "text/plain"): void {
  downloadBlob(filename, new Blob([text], { type: `${type};charset=utf-8` }));
}
