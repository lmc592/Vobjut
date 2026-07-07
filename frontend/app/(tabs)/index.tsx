import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { theme } from "@/src/theme";
import { money } from "@/src/components/ui";

type Stats = {
  open_leads: number; customers: number; draft_quotes: number;
  accepted_quotes: number; active_jobs: number; completed_jobs: number; pipeline_value: number;
};

export default function Dashboard() {
  const { user, company, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const [stats, setStats] = useState<Stats | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setStats(await api<Stats>("/dashboard/stats")); } catch {}
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  const cards = [
    { label: "Open Leads", value: stats?.open_leads ?? 0, icon: "flame", color: "#F97316" },
    { label: "Customers", value: stats?.customers ?? 0, icon: "people", color: "#3B82F6" },
    { label: "Draft Quotes", value: stats?.draft_quotes ?? 0, icon: "document-text", color: "#94A3B8" },
    { label: "Accepted", value: stats?.accepted_quotes ?? 0, icon: "checkmark-circle", color: "#22C55E" },
    { label: "Active Jobs", value: stats?.active_jobs ?? 0, icon: "hammer", color: "#EAB308" },
    { label: "Completed", value: stats?.completed_jobs ?? 0, icon: "trophy", color: "#8B5CF6" },
  ];

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View>
          <Text style={styles.hello}>Hi, {user?.name?.split(" ")[0]}</Text>
          <Text style={styles.company}>{company?.name} · {user?.role}</Text>
        </View>
        <Pressable onPress={logout} style={styles.logout} testID="logout-button">
          <Ionicons name="log-out-outline" size={22} color={theme.colors.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}>
        <View style={styles.pipeline} testID="pipeline-card">
          <Text style={styles.pipelineLabel}>Pipeline Value (sent + accepted)</Text>
          <Text style={styles.pipelineValue}>{money(stats?.pipeline_value ?? 0)}</Text>
        </View>

        <View style={styles.grid}>
          {cards.map((c) => (
            <View key={c.label} style={styles.statCard} testID={`stat-${c.label}`}>
              <View style={[styles.iconWrap, { backgroundColor: c.color + "22" }]}>
                <Ionicons name={c.icon as any} size={20} color={c.color} />
              </View>
              <Text style={styles.statValue}>{c.value}</Text>
              <Text style={styles.statLabel}>{c.label}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.section}>Workflow</Text>
        <View style={styles.flow}>
          {["Lead", "Quote", "Accepted", "Job", "Invoice"].map((s, i) => (
            <View key={s} style={styles.flowRow}>
              <View style={styles.flowDot}><Text style={styles.flowNum}>{i + 1}</Text></View>
              <Text style={styles.flowText}>{s}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  hello: { color: theme.colors.text, fontSize: 20, fontWeight: "800" },
  company: { color: theme.colors.textMuted, fontSize: 13, marginTop: 2 },
  logout: { padding: 8 },
  pipeline: { backgroundColor: theme.colors.primary, borderRadius: theme.radius.lg, padding: theme.spacing.lg, marginBottom: theme.spacing.md },
  pipelineLabel: { color: "#fff", opacity: 0.9, fontSize: 13, fontWeight: "600" },
  pipelineValue: { color: "#fff", fontSize: 30, fontWeight: "800", marginTop: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
  statCard: { width: "31.5%", backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border },
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: theme.spacing.sm },
  statValue: { color: theme.colors.text, fontSize: 22, fontWeight: "800" },
  statLabel: { color: theme.colors.textMuted, fontSize: 11, marginTop: 2 },
  section: { color: theme.colors.text, fontSize: 16, fontWeight: "700", marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm },
  flow: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border },
  flowRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  flowDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: theme.colors.primary + "22", alignItems: "center", justifyContent: "center", marginRight: theme.spacing.md },
  flowNum: { color: theme.colors.primary, fontWeight: "800", fontSize: 13 },
  flowText: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
});
