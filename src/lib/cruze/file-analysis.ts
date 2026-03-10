// CRUZE UPGRADE — OMNISCIENT MODE
// File analysis utilities for drag & drop support
// Handles CSV, Excel, PDF, and images

/** Supported file types and their MIME types */
export const SUPPORTED_FILE_TYPES = {
  csv: ["text/csv", "application/csv"],
  excel: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
  ],
  pdf: ["application/pdf"],
  image: ["image/png", "image/jpeg", "image/webp", "image/gif"],
} as const;

export type FileCategory = keyof typeof SUPPORTED_FILE_TYPES;

/** Check if a MIME type is supported */
export function getFileCategory(mimeType: string): FileCategory | null {
  for (const [category, types] of Object.entries(SUPPORTED_FILE_TYPES)) {
    if ((types as readonly string[]).includes(mimeType)) {
      return category as FileCategory;
    }
  }
  return null;
}

/** Maximum file sizes (in bytes) */
export const MAX_FILE_SIZES: Record<FileCategory, number> = {
  csv: 10 * 1024 * 1024,     // 10MB
  excel: 10 * 1024 * 1024,   // 10MB
  pdf: 20 * 1024 * 1024,     // 20MB
  image: 10 * 1024 * 1024,   // 10MB
};

/** Validate a file for upload */
export function validateFile(file: File): { valid: boolean; error?: string; category?: FileCategory } {
  const category = getFileCategory(file.type);

  if (!category) {
    return {
      valid: false,
      error: `Unsupported file type: ${file.type || file.name.split(".").pop()}. Supported: CSV, Excel, PDF, images.`,
    };
  }

  const maxSize = MAX_FILE_SIZES[category];
  if (file.size > maxSize) {
    const maxMB = Math.round(maxSize / (1024 * 1024));
    return {
      valid: false,
      error: `File too large (${Math.round(file.size / (1024 * 1024))}MB). Max for ${category}: ${maxMB}MB.`,
    };
  }

  return { valid: true, category };
}

/** Convert file to base64 for API transmission */
export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix (e.g., "data:image/png;base64,")
      const base64 = result.split(",")[1] || result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Parse CSV text into a preview (first N rows) */
export function parseCSVPreview(text: string, maxRows = 10): { headers: string[]; rows: string[][]; totalRows: number } {
  const lines = text.split("\n").filter((l) => l.trim());
  const headers = parseCSVLine(lines[0] || "");
  const rows = lines.slice(1, maxRows + 1).map(parseCSVLine);
  return { headers, rows, totalRows: lines.length - 1 };
}

/** Simple CSV line parser (handles quoted fields) */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/** Format file size for display */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Get a file icon name based on category */
export function getFileIcon(category: FileCategory): string {
  switch (category) {
    case "csv": return "table";
    case "excel": return "table";
    case "pdf": return "file-text";
    case "image": return "image";
  }
}
