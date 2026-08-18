/** Zapis pliku bez pośrednika: treść jest już w pamięci przeglądarki. */
export function download(name: string, content: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
