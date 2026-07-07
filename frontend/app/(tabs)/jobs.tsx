import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, FlatList, RefreshControl, Modal,
  ScrollView, TextInput, KeyboardAvoidingView, Platform,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";
import { StatusBadge, EmptyState, money } from "@/src/components/ui";

const JOB_STATUSES = ["SCHEDULED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "INVOICED"];

export default function Jobs() {
  const insets = useSafeAreaInsets();
  const [jobs, setJobs] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try { setJobs(await api("/jobs")); } catch {}
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  async function openDetail(id: string) {
    const d = await api(`/jobs/${id}`);
    setDetail(d);
  }

  async function setStatus(status: string) {
    if (!detail) return;
    const progress = status === "COMPLETED" ? 100 : detail.progress;
    await api(`/jobs/${detail.id}/progress`, { method: "PATCH", body: { status, progress } });
    await openDetail(detail.id); load();
  }

  async function setProgress(delta: number) {
    if (!detail) return;
    const p = Math.max(0, Math.min(100, (detail.progress || 0) + delta));
    await api(`/jobs/${detail.id}/progress`, { method: "PATCH", body: { progress: p } });
    await openDetail(detail.id); load();
  }

  async function addNote() {
    if (!detail || !note.trim()) return;
    await api(`/jobs/${detail.id}/notes`, { method: "POST", body: { body: note.trim() } });
    setNote("");
    await openDetail(detail.id);
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.title}>Jobs</Text>
        <Text style={styles.sub}>Created from accepted quotes</Text>
      </View>

      <FlatList
        data={jobs}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
        ListEmptyComponent={<EmptyState icon="hammer-outline" title="No jobs yet" subtitle="Accept a quote and convert it to a job" />}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => openDetail(item.id)} testID={`job-${item.id}`}>
            <View style={styles.cardTop}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <StatusBadge status={item.status} />
            </View>
            {!!item.value && <Text style={styles.value}>{money(item.value)}</Text>}
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${item.progress || 0}%` }]} />
            </View>
            <Text style={styles.cardMeta}>{item.progress || 0}% complete</Text>
          </Pressable>
        )}
      />

      <Modal visible={!!detail} animationType="slide" onRequestClose={() => setDetail(null)}>
        <KeyboardAvoidingView style={[styles.container, { paddingTop: insets.top }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.dHeader}>
            <Pressable onPress={() => setDetail(null)} testID="job-detail-close"><Ionicons name="close" size={26} color={theme.colors.text} /></Pressable>
            <Text style={styles.dTitle} numberOfLines={1}>{detail?.title}</Text>
            <View style={{ width: 26 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            {detail && (
              <>
                <View style={styles.detailCard}>
                  <View style={styles.rowBetween}>
                    <StatusBadge status={detail.status} />
                    {!!detail.value && <Text style={styles.value}>{money(detail.value)}</Text>}
                  </View>
                  <View style={[styles.progressBar, { marginTop: 12 }]}>
                    <View style={[styles.progressFill, { width: `${detail.progress || 0}%` }]} />
                  </View>
                  <View style={styles.progressControls}>
                    <Pressable style={styles.pBtn} onPress={() => setProgress(-10)} testID="progress-minus"><Ionicons name="remove" size={18} color={theme.colors.text} /></Pressable>
                    <Text style={styles.pText}>{detail.progress || 0}%</Text>
                    <Pressable style={styles.pBtn} onPress={() => setProgress(10)} testID="progress-plus"><Ionicons name="add" size={18} color={theme.colors.text} /></Pressable>
                  </View>
                </View>

                <Text style={styles.section}>Status</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {JOB_STATUSES.map((s) => (
                    <Pressable key={s} onPress={() => setStatus(s)} style={[styles.chip, detail.status === s && styles.chipActive]} testID={`job-status-${s}`}>
                      <Text style={[styles.chipText, detail.status === s && styles.chipTextActive]}>{s.replace("_", " ")}</Text>
                    </Pressable>
                  ))}
                </ScrollView>

                <Text style={styles.section}>Notes ({detail.notes?.length || 0})</Text>
                <View style={styles.noteInputRow}>
                  <TextInput style={styles.noteInput} placeholder="Add a site note..." placeholderTextColor={theme.colors.textMuted} value={note} onChangeText={setNote} testID="job-note-input" />
                  <Pressable style={styles.noteBtn} onPress={addNote} testID="job-note-add"><Ionicons name="send" size={18} color="#fff" /></Pressable>
                </View>
                {(detail.notes || []).map((n: any) => (
                  <View key={n.id} style={styles.note}>
                    <Text style={styles.noteText}>{n.body}</Text>
                    <Text style={styles.noteTime}>{new Date(n.created_at).toLocaleString("en-AU")}</Text>
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  header: { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  title: { color: theme.colors.text, fontSize: 22, fontWeight: "800" },
  sub: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border, marginBottom: theme.spacing.sm },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "700", flex: 1, marginRight: 8 },
  value: { color: theme.colors.primary, fontSize: 16, fontWeight: "800" },
  cardMeta: { color: theme.colors.textMuted, fontSize: 12, marginTop: 4 },
  progressBar: { height: 8, backgroundColor: theme.colors.surfaceAlt, borderRadius: 4, marginTop: 10, overflow: "hidden" },
  progressFill: { height: 8, backgroundColor: theme.colors.primary, borderRadius: 4 },
  dHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  dTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "800", flex: 1, textAlign: "center", marginHorizontal: 8 },
  detailCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressControls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing.lg, marginTop: theme.spacing.md },
  pBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.surfaceAlt, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.colors.border },
  pText: { color: theme.colors.text, fontSize: 18, fontWeight: "800", minWidth: 56, textAlign: "center" },
  section: { color: theme.colors.text, fontSize: 15, fontWeight: "700", marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm },
  chip: { paddingHorizontal: 14, height: 36, borderRadius: 18, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { color: theme.colors.textMuted, fontWeight: "600", fontSize: 13 },
  chipTextActive: { color: "#fff" },
  noteInputRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  noteInput: { flex: 1, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.md, height: 48, color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.border },
  noteBtn: { width: 48, height: 48, borderRadius: theme.radius.md, backgroundColor: theme.colors.primary, alignItems: "center", justifyContent: "center" },
  note: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border, marginTop: theme.spacing.sm },
  noteText: { color: theme.colors.text, fontSize: 14 },
  noteTime: { color: theme.colors.textMuted, fontSize: 11, marginTop: 4 },
});
