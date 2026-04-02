import { api } from "./api";

export const reportSecurityEvent = async (eventType, description, metadata = {}) => {
  try {
    return await api.post("/security/report-event", {
      eventType,
      description,
      metadata
    });
  } catch (error) {
    console.error("Failed to report security event:", error.message);
    throw error;
  }
};
