import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, Modal, TextInput,
  KeyboardAvoidingView, Platform, FlatList, RefreshControl,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";
import { StatusBadge, EmptyState, Fab, money } from "@/src/components/ui";

const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST"];

export default function CRM() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<"leads" | "customers">("leads");
  const [leads, setLeads] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<any>({ title: "", contact_name: "", contact_phone: "", trade: "", estimated_value: "" });
  const [custForm, setCustForm] = useState<any>({ name: "", phone: "", email: "", suburb: "" });

  const load = useCallback(async () => {
    try {
      const [l, c] = await Promise.all([api("/leads"), api("/customers")]);
      setLeads(l); setCustomers(c);
    } catch {}
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  async function cycleStatus(lead: any) {
    const idx = LEAD_STATUSES.indexOf(lead.status);
    const next = LEAD_STATUSES[(idx + 1) % 4]; // cycle NEW->CONTACTED->QUALIFIED->CONVERTED
    await api(`/leads/${lead.id}/status`, { method: "PATCH", body: { status: next } });
    load();
  }

  async function convert(lead: any) {
    await api(`/leads/${lead.id}/convert`, { method: "POST" });
    load();
  }

  async function save() {
    if (tab === "leads") {
      if (!form.title.trim()) return;
      await api("/leads", { method: "POST", body: { ...form, estimated_value: parseFloat(form.estimated_value) || 0 } });
      setForm({ title: "", contact_name: "", contact_phone: "", trade: "", estimated_value: "" });
    } else {
      if (!custForm.name.trim()) return;
      await api("/customers", { method: "POST", body: custForm });
      setCustForm({ name: "", phone: "", email: "", suburb: "" });
    }
    setModal(false);
    load();
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.title}>CRM</Text>
        <View style={styles.segment}>
          {(["leads", "customers"] as const).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} style={[styles.segBtn, tab === t && styles.segActive]} testID={`crm-tab-${t}`}>
              <Text style={[styles.segText, tab === t && styles.segTextActive]}>{t === "leads" ? "Leads" : "Customers"}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {tab === "leads" ? (
        <FlatList
          data={leads}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 90 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
          ListEmptyComponent={<EmptyState icon="flame-outline" title="No leads yet" subtitle="Tap + to add your first lead" />}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`lead-${item.id}`}>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <StatusBadge status={item.status} />
              </View>
              {!!item.contact_name && <Text style={styles.cardSub}>{item.contact_name} · {item.contact_phone || "no phone"}</Text>}
              <Text style={styles.cardMeta}>{item.trade || "General"} · Est. {money(item.estimated_value || 0)}</Text>
              {item.status !== "CONVERTED" && item.status !== "LOST" && (
                <View style={styles.actions}>
                  <Pressable style={styles.actBtn} onPress={() => cycleStatus(item)} testID={`lead-advance-${item.id}`}>
                    <Ionicons name="arrow-forward-circle" size={16} color={theme.colors.info} />
                    <Text style={styles.actText}>Advance</Text>
                  </Pressable>
                  <Pressable style={styles.actBtn} onPress={() => convert(item)} testID={`lead-convert-${item.id}`}>
                    <Ionicons name="person-add" size={16} color={theme.colors.success} />
                    <Text style={[styles.actText, { color: theme.colors.success }]}>Convert</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}
        />
      ) : (
        <FlatList
          data={customers}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 90 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
          ListEmptyComponent={<EmptyState icon="people-outline" title="No customers yet" />}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`customer-${item.id}`}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              <Text style={styles.cardSub}>{item.phone || "no phone"} · {item.email || "no email"}</Text>
              {!!item.suburb && <Text style={styles.cardMeta}>{item.suburb}</Text>}
            </View>
          )}
        />
      )}

      <Fab onPress={() => setModal(true)} testID="crm-add-button" />

      <Modal visible={modal} animationType="slide" transparent onRequestClose={() => setModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{tab === "leads" ? "New Lead" : "New Customer"}</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {tab === "leads" ? (
                <>
                  <Input ph="Lead title *" v={form.title} on={(t: string) => setForm({ ...form, title: t })} testID="lead-title-input" />
                  <Input ph="Contact name" v={form.contact_name} on={(t: string) => setForm({ ...form, contact_name: t })} />
                  <Input ph="Contact phone" v={form.contact_phone} on={(t: string) => setForm({ ...form, contact_phone: t })} />
                  <Input ph="Trade (e.g. Concrete)" v={form.trade} on={(t: string) => setForm({ ...form, trade: t })} />
                  <Input ph="Estimated value" v={form.estimated_value} on={(t: string) => setForm({ ...form, estimated_value: t })} kb="numeric" />
                </>
              ) : (
                <>
                  <Input ph="Customer name *" v={custForm.name} on={(t: string) => setCustForm({ ...custForm, name: t })} testID="customer-name-input" />
                  <Input ph="Phone" v={custForm.phone} on={(t: string) => setCustForm({ ...custForm, phone: t })} />
                  <Input ph="Email" v={custForm.email} on={(t: string) => setCustForm({ ...custForm, email: t })} kb="email-address" />
                  <Input ph="Suburb" v={custForm.suburb} on={(t: string) => setCustForm({ ...custForm, suburb: t })} />
                </>
              )}
            </ScrollView>
            <View style={styles.sheetActions}>
              <Pressable style={styles.cancelBtn} onPress={() => setModal(false)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
              <Pressable style={styles.saveBtn} onPress={save} testID="crm-save-button"><Text style={styles.saveText}>Save</Text></Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

export function Input({ ph, v, on, kb, testID }: any) {
  return (
    <TextInput style={sInput.input} placeholder={ph} placeholderTextColor={theme.colors.textMuted}
      value={v} onChangeText={on} keyboardType={kb} autoCapitalize={kb === "email-address" ? "none" : "sentences"} testID={testID} />
  );
}
const sInput = StyleSheet.create({
  input: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.md, height: 48, color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.border, marginBottom: theme.spacing.sm },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  header: { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  title: { color: theme.colors.text, fontSize: 22, fontWeight: "800", marginBottom: theme.spacing.md },
  segment: { flexDirection: "row", backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, padding: 4 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: theme.radius.sm, alignItems: "center" },
  segActive: { backgroundColor: theme.colors.primary },
  segText: { color: theme.colors.textMuted, fontWeight: "700", fontSize: 13 },
  segTextActive: { color: "#fff" },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border, marginBottom: theme.spacing.sm },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "700", flex: 1, marginRight: 8 },
  cardSub: { color: theme.colors.textMuted, fontSize: 13, marginTop: 4 },
  cardMeta: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  actions: { flexDirection: "row", gap: theme.spacing.md, marginTop: theme.spacing.sm, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: theme.spacing.sm },
  actBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  actText: { color: theme.colors.info, fontSize: 13, fontWeight: "600" },
  modalWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radius.xl, borderTopRightRadius: theme.radius.xl, padding: theme.spacing.lg, maxHeight: "80%" },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.border, alignSelf: "center", marginBottom: theme.spacing.md },
  sheetTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "800", marginBottom: theme.spacing.md },
  sheetActions: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.md },
  cancelBtn: { flex: 1, height: 48, borderRadius: theme.radius.md, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surfaceAlt },
  cancelText: { color: theme.colors.text, fontWeight: "700" },
  saveBtn: { flex: 2, height: 48, borderRadius: theme.radius.md, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.primary },
  saveText: { color: "#fff", fontWeight: "700" },
});
