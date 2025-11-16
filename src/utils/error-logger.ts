import fs from 'fs';
import path from 'path';
import { ChatHistoryManager } from './chat-history-manager.js';

/**
 * Log API error with full request/response for debugging
 * @param requestPayload Request that was sent to the API
 * @param error Error that occurred
 * @param metadata Additional metadata about the error (testType, status code, etc.)
 * @param prefix Filename prefix (e.g., "500", "test-fail")
 * @returns Object with file paths and formatted error message
 */
export async function logApiError(
  requestPayload: any,
  error: any,
  metadata: Record<string, any>,
  prefix: string
): Promise<{ requestFile: string; responseFile: string; message: string }> {
  const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
  const historyManager = ChatHistoryManager.getInstance();
  const contextPath = historyManager.getContextFilePath();
  const errorDir = path.join(path.dirname(contextPath), 'error-logs');

  // Ensure error-logs directory exists
  try {
    if (!fs.existsSync(errorDir)) {
      fs.mkdirSync(errorDir, { recursive: true });
    }
  } catch (mkdirErr) {
    console.error('Failed to create error-logs directory:', mkdirErr);
  }

  const requestFile = `${errorDir}/${prefix}-${timestamp}-request.json`;
  const responseFile = `${errorDir}/${prefix}-${timestamp}-response.txt`;

  // Write request payload
  try {
    fs.writeFileSync(requestFile, JSON.stringify(requestPayload, null, 2));
  } catch (writeErr) {
    console.error('Failed to write request file:', writeErr);
  }

  // Write response error details
  try {
    const responseData = {
      ...metadata,
      status: error.status,
      message: error.message,
      error: error.error,
      response: error.response,
      rawBody: error.response?.data || error.response?.body,
    };
    fs.writeFileSync(responseFile, JSON.stringify(responseData, null, 2));
  } catch (writeErr) {
    console.error('Failed to write response file:', writeErr);
  }

  return {
    requestFile,
    responseFile,
    message: `Request logged to: ${requestFile}\nResponse logged to: ${responseFile}`
  };
}
