import type { DocumentPickerAsset } from 'expo-document-picker';

export async function saveTextFile(content: string, fileName: string, mimeType: string, _uti?: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readTextFile(asset: DocumentPickerAsset): Promise<string> {
  if (!asset.file) throw new Error('The browser did not provide a readable file. Please select it again.');
  return asset.file.text();
}

// The browser's print dialog provides Save as PDF. Scripts in exported HTML cannot run.
export async function savePdfFile(html: string, fileName: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.title = fileName;
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
    frame.style.cssText = 'position:fixed;width:1px;height:1px;bottom:0;left:0;border:0';
    const cleanup = () => frame.remove();
    frame.onload = () => {
      const target = frame.contentWindow;
      if (!target) { cleanup(); reject(new Error('Unable to open the print preview.')); return; }
      target.document.title = fileName.replace(/\.pdf$/i, '');
      target.addEventListener('afterprint', cleanup, { once: true });
      try { target.focus(); target.print(); resolve(); }
      catch (error) { cleanup(); reject(error); }
      setTimeout(cleanup, 60_000);
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}
