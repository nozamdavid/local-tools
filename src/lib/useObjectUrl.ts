import { useEffect, useState } from 'react';

export function useObjectUrl(fileOrBlob: Blob | File | null | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!fileOrBlob) {
      setUrl(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(fileOrBlob);
    setUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [fileOrBlob]);

  return url;
}
