import { File, Paths } from 'expo-file-system';
import { readAsStringAsync, writeAsStringAsync, EncodingType, StorageAccessFramework } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import type { DocumentPickerAsset } from 'expo-document-picker';

async function saveToDevice(
  cacheUri: string,
  fileName: string,
  mimeType: string,
  uti?: string,
): Promise<void> {
  if (Platform.OS === 'android') {
    const permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permissions.granted) {
      // User cancelled the folder picker — fall back to share sheet
      await Sharing.shareAsync(cacheUri, { mimeType, UTI: uti });
      return;
    }
    const isBinary = mimeType === 'application/pdf';
    const destUri = await StorageAccessFramework.createFileAsync(
      permissions.directoryUri,
      fileName,
      mimeType,
    );
    const content = await readAsStringAsync(cacheUri, {
      encoding: isBinary ? EncodingType.Base64 : EncodingType.UTF8,
    });
    await writeAsStringAsync(destUri, content, {
      encoding: isBinary ? EncodingType.Base64 : EncodingType.UTF8,
    });
  } else {
    // iOS — share sheet includes "Save to Files"
    await Sharing.shareAsync(cacheUri, { mimeType, UTI: uti });
  }
}

export async function saveTextFile(content: string, fileName: string, mimeType: string, uti?: string): Promise<void> {
  const file = new File(Paths.cache, fileName);
  file.write(content);
  await saveToDevice(file.uri, fileName, mimeType, uti);
}

export async function readTextFile(asset: DocumentPickerAsset): Promise<string> {
  return new File(asset.uri).text();
}

export async function savePdfFile(html: string, fileName: string): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  const destFile = new File(Paths.cache, fileName);
  new File(uri).move(destFile);
  await saveToDevice(destFile.uri, fileName, 'application/pdf', 'com.adobe.pdf');
}
