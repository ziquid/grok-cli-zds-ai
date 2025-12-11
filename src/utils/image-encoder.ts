import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Image data structure for vision API requests
 */
export interface ImageData {
  type: "image_url";
  image_url: {
    url: string;
  };
}

/**
 * Parsed message with text and images separated
 */
export interface ParsedMessage {
  text: string;
  images: ImageData[];
}

/**
 * Supported image formats
 */
const SUPPORTED_FORMATS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
];

/**
 * Detect if a file path points to a valid image file
 */
function isValidImageFile(filePath: string): boolean {
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return false;
    }

    // Check if it's a file (not directory)
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      return false;
    }

    // Check file extension
    const ext = path.extname(filePath).toLowerCase();
    return SUPPORTED_FORMATS.includes(ext);
  } catch (error) {
    return false;
  }
}

/**
 * Get MIME type from file extension
 */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
  };
  return mimeTypes[ext] || "image/jpeg";
}

/**
 * Encode image file to base64 data URL
 */
function encodeImageToBase64(filePath: string): string {
  const imageBuffer = fs.readFileSync(filePath);
  const base64Data = imageBuffer.toString("base64");
  const mimeType = getMimeType(filePath);
  return `data:${mimeType};base64,${base64Data}`;
}

/**
 * Parse user message for @image_path syntax and extract images
 * Returns cleaned text and array of image data structures
 *
 * Example inputs:
 *   "What's in this image? @/path/to/photo.jpg"
 *   "Analyze @\"~/My Pictures/photo.jpg\""
 *   "Compare @/path/with\\ spaces/image.jpg"
 *
 * Example output: {
 *   text: "What's in this image?",
 *   images: [{ type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } }]
 * }
 */
export function parseImagesFromMessage(
  message: string,
  cwd?: string
): ParsedMessage {
  const images: ImageData[] = [];
  const errors: string[] = [];

  // Pattern: @ followed by either:
  //   1. Quoted path: @"path with spaces"
  //   2. Unquoted path: @path (stops at whitespace)
  // Captures quoted content in group 1, unquoted content in group 2
  const imagePattern = /@"([^"]+)"|@([^\s]+)/g;

  // Extract all @path references
  let match;
  while ((match = imagePattern.exec(message)) !== null) {
    // Get path from either quoted (group 1) or unquoted (group 2) capture
    let imagePath = match[1] || match[2];

    // Unescape spaces (convert \<space> to <space>)
    imagePath = imagePath.replace(/\\ /g, " ");

    // Expand tilde to home directory
    if (imagePath.startsWith("~/") || imagePath === "~") {
      imagePath = path.join(os.homedir(), imagePath.slice(2));
    }

    // Resolve relative paths
    const resolvedPath = path.isAbsolute(imagePath)
      ? imagePath
      : path.resolve(cwd || process.cwd(), imagePath);

    // Validate and encode
    if (!isValidImageFile(resolvedPath)) {
      errors.push(`Invalid or missing image file: ${imagePath}`);
      continue;
    }

    try {
      const base64Url = encodeImageToBase64(resolvedPath);
      images.push({
        type: "image_url",
        image_url: {
          url: base64Url,
        },
      });
    } catch (error) {
      errors.push(
        `Failed to encode image ${imagePath}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  // Remove @path references from text
  const cleanedText = message.replace(imagePattern, "").trim();

  // If there were errors, append them to the cleaned text
  const finalText =
    errors.length > 0
      ? `${cleanedText}\n\n[Image loading errors: ${errors.join(", ")}]`
      : cleanedText;

  return {
    text: finalText,
    images,
  };
}

/**
 * Check if a message contains image references
 */
export function hasImageReferences(message: string): boolean {
  return /@"([^"]+)"|@([^\s]+)/.test(message);
}
