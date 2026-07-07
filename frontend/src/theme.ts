export const theme = {
  colors: {
    bg: "#0F1419",
    surface: "#1A2129",
    surfaceAlt: "#232D38",
    border: "#2E3A47",
    primary: "#F97316", // construction orange
    primaryDark: "#C2410C",
    text: "#F1F5F9",
    textMuted: "#94A3B8",
    success: "#22C55E",
    warning: "#EAB308",
    danger: "#EF4444",
    info: "#3B82F6",
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 8, md: 12, lg: 16, xl: 24 },
};

export const statusColor: Record<string, string> = {
  NEW: "#3B82F6",
  CONTACTED: "#EAB308",
  QUALIFIED: "#8B5CF6",
  CONVERTED: "#22C55E",
  LOST: "#EF4444",
  DRAFT: "#94A3B8",
  SENT: "#3B82F6",
  ACCEPTED: "#22C55E",
  REJECTED: "#EF4444",
  EXPIRED: "#78716C",
  SCHEDULED: "#3B82F6",
  IN_PROGRESS: "#F97316",
  ON_HOLD: "#EAB308",
  COMPLETED: "#22C55E",
  INVOICED: "#8B5CF6",
  CANCELLED: "#EF4444",
};
