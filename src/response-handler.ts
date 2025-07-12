// Helper functions to handle the new standardized response format

interface StandardResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message?: string;
    details?: any;
  };
  meta?: {
    timestamp: string;
    pagination?: {
      total: number;
      limit: number;
      offset: number;
      page?: number;
      totalPages?: number;
    };
  };
  nextAction?: string;
}

export async function handleApiResponse(response: any): Promise<any> {
  const responseData = await response.json() as StandardResponse;
  
  // Handle new standardized format
  if ('success' in responseData) {
    if (responseData.success === false) {
      // Handle error response
      const errorCode = responseData.error?.code || 'UNKNOWN_ERROR';
      // Backend uses 'details' for the error message, not 'message'
      const errorMessage = responseData.error?.details || responseData.error?.message || 'Unknown error';
      
      // Build complete error message
      let fullMessage = `[${errorCode}] ${errorMessage}`;
      
      // Append nextAction if available (these are already well-formatted suggestions)
      if (responseData.nextAction) {
        fullMessage += `. ${responseData.nextAction}`;
      }
      
      throw new Error(fullMessage);
    }
    
    // Return the data field for successful responses
    return responseData.data;
  }
  
  // Fallback for old format (shouldn't happen if all endpoints are updated)
  return responseData;
}

export function formatSuccessMessage(operation: string, data: any): string {
  // If data contains a message, use it
  if (data && typeof data === 'object' && 'message' in data) {
    return `${data.message}\n${JSON.stringify(data, null, 2)}`;
  }
  
  // Otherwise, create a generic success message
  return `${operation} completed successfully:\n${JSON.stringify(data, null, 2)}`;
}