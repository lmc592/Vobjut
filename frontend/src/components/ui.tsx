import React from "react";
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme, statusColor } from "@/src/theme";

export function StatusBadge({ status }: { status: string }) {
  const color = statusColor[status] || theme.colors.textMuted;
  return (
    <View style={[badge.wrap, { backgroundColor: color + "22", borderColor: color }]}>
      <Text style={[badge.text, { color }]}>{status.replace("_", " ")}</Text>
    </View>
  );
}

const badge = StyleSheet.create({
  wrap: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, alignSelf: "flex-start" },
  text: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
});

export function Loading() {
  return <View style={c.center}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;
}

export function EmptyState({ icon, title, subtitle }: { icon: any; title: string; subtitle?: string }) {
  return (
    <View style={c.center}>
      <Ionicons name={icon} size={44} color={theme.colors.border} />
      <Text style={c.emptyTitle}>{title}</Text>
      {!!subtitle && <Text style={c.emptySub}>{subtitle}</Text>}
    </View>
  );
}

export function Fab({ onPress, testID }: { onPress: () => void; testID?: string }) {
  return (
    <Pressable style={c.fab} onPress={onPress} testID={testID}>
      <Ionicons name="add" size={28} color="#fff" />
    </Pressable>
  );
}

export function money(n: number) {
  return "$" + (n || 0).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const c = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: theme.spacing.xl },
  emptyTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "700", marginTop: theme.spacing.md },
  emptySub: { color: theme.colors.textMuted, fontSize: 13, marginTop: 4, textAlign: "center" },
  fab: {
    position: "absolute", right: theme.spacing.md, bottom: theme.spacing.lg,
    width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.primary,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
});
