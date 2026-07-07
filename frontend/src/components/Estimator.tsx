import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, Modal, ScrollView, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";
import { money } from "@/src/components/ui";

type Line = {
  description: string; kind: string; unit: string; quantity: number;
  unit_rate: number; pricing_rate_id: string | null; line_total: number;
};

const TRADES: { key: string; label: string; icon: string; fields: { key: string; label: string; def?: string }[] }[] = [
  { key: "concrete_slab", label: "Concrete Slab", icon: "cube", fields: [
    { key: "area_m2", label: "Area (m²)" }, { key: "thickness_mm", label: "Thickness (mm)", def: "100" } ] },
  { key: "fencing", label: "Fencing", icon: "git-commit", fields: [
    { key: "length_m", label: "Length (m)" }, { key: "panel_width_m", label: "Panel width (m)", def: "2.4" } ] },
  { key: "retaining_wall", label: "Retaining Wall", icon: "layers", fields: [
    { key: "length_m", label: "Length (m)" }, { key: "height_m", label: "Height (m)", def: "1.0" } ] },
  { key: "turf", label: "Turf / Landscape", icon: "leaf", fields: [
    { key: "area_m2", label: "Area (m²)" } ] },
  { key: "earthworks", label: "Earthworks", icon: "car", fields: [
    { key: "area_m2", label: "Area (m²)" }, { key: "depth_m", label: "Depth (m)", def: "0.3" } ] },
];

export default function Estimator({ visible, onClose, onAdd }:
  { visible: boolean; onClose: () => void; onAdd: (lines: any[]) => void }) {
  const [trade, setTrade] = useState(TRADES[0]);
  const [params, setParams] = useState<Record<string, string>>({});
  const [items, setItems] = useState<Line[]>([]);
  const [assumptions, setAssumptions] = useState<any>(null);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [templates, setTemplates] = useState<any[]>([]);
  const [showSave, setShowSave] = useState(false);
  const [tplName, setTplName] = useState("");
  const [rateStr, setRateStr] = useState<Record<number, string>>({});

  useEffect(() => {
    if (visible) {
      api("/estimate-templates").then(setTemplates).catch(() => {});
    }
  }, [visible]);

  async function loadTemplates() {
    try { setTemplates(await api("/estimate-templates")); } catch {}
  }

  function applyTemplate(tpl: any) {
    const t = TRADES.find((x) => x.key === tpl.trade) || TRADES[0];
    setTrade(t);
    const p: Record<string, string> = {};
    Object.entries(tpl.params || {}).forEach(([k, v]) => { p[k] = String(v); });
    setParams(p); setItems([]); setAssumptions(null); setSelected({}); setError("");
  }

  async function saveTemplate() {
    if (!tplName.trim()) return;
    const num: Record<string, number> = {};
    Object.entries(params).forEach(([k, v]) => { num[k] = parseFloat(v) || 0; });
    await api("/estimate-templates", { method: "POST", body: { name: tplName.trim(), trade: trade.key, params: num } });
    setTplName(""); setShowSave(false); loadTemplates();
  }

  async function removeTemplate(id: string) {
    await api(`/estimate-templates/${id}`, { method: "DELETE" });
    loadTemplates();
  }

  function editRate(idx: number, val: string) {
    setRateStr((prev) => ({ ...prev, [idx]: val }));
    const r = parseFloat(val) || 0;
    setItems((prev) => prev.map((it, i) =>
      i === idx ? { ...it, unit_rate: r, line_total: Math.round(it.quantity * r * 100) / 100 } : it));
  }

  function pickTrade(t: typeof TRADES[0]) {
    setTrade(t);
    const init: Record<string, string> = {};
    t.fields.forEach((f) => { if (f.def) init[f.key] = f.def; });
    setParams(init); setItems([]); setAssumptions(null); setSelected({}); setError("");
  }

  async function compute() {
    setError(""); setBusy(true);
    try {
      const num: Record<string, number> = {};
      Object.entries(params).forEach(([k, v]) => { num[k] = parseFloat(v) || 0; });
      const res = await api<{ items: Line[]; assumptions: any }>("/estimate-materials", {
        method: "POST", body: { trade: trade.key, params: num },
      });
      setItems(res.items);
      setAssumptions(res.assumptions);
      const sel: Record<number, boolean> = {};
      const rs: Record<number, string> = {};
      res.items.forEach((it, i) => { sel[i] = true; rs[i] = String(it.unit_rate); });
      setSelected(sel);
      setRateStr(rs);
    } catch (e: any) {
      setError(e.message || "Could not estimate");
    } finally { setBusy(false); }
  }

  function addSelected() {
    const lines = items.filter((_, i) => selected[i]).map((it) => ({
      description: it.description, kind: it.kind, quantity: it.quantity,
      unit: it.unit, unit_rate: it.unit_rate, pricing_rate_id: it.pricing_rate_id,
    }));
    if (lines.length) onAdd(lines);
    onClose();
  }

  const total = items.reduce((a, it, i) => a + (selected[i] ? it.line_total : 0), 0);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <Pressable onPress={onClose} testID="estimator-close"><Ionicons name="close" size={26} color={theme.colors.text} /></Pressable>
          <Text style={styles.title}>Quantity Estimator</Text>
          <View style={{ width: 26 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Trade</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
            {TRADES.map((t) => (
              <Pressable key={t.key} onPress={() => pickTrade(t)} style={[styles.tchip, trade.key === t.key && styles.tchipActive]} testID={`est-trade-${t.key}`}>
                <Ionicons name={t.icon as any} size={15} color={trade.key === t.key ? "#fff" : theme.colors.textMuted} />
                <Text style={[styles.tchipText, trade.key === t.key && { color: "#fff" }]}>{t.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.inputsRow}>
            {trade.fields.map((f) => (
              <View key={f.key} style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.label}>{f.label}</Text>
                <TextInput style={styles.input} keyboardType="numeric" placeholder="0"
                  placeholderTextColor={theme.colors.textMuted}
                  value={params[f.key] ?? ""} onChangeText={(v) => setParams({ ...params, [f.key]: v })}
                  testID={`est-field-${f.key}`} />
              </View>
            ))}
          </View>

          <Pressable style={styles.calcBtn} onPress={compute} disabled={busy} testID="est-calculate-button">
            {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="calculator" size={18} color="#fff" /><Text style={styles.calcText}>Calculate Quantities</Text></>}
          </Pressable>
          {!!error && <Text style={styles.error} testID="est-error">{error}</Text>}

          {templates.length > 0 && (
            <>
              <Text style={styles.label}>Saved templates</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                {templates.map((tpl) => (
                  <Pressable key={tpl.id} onPress={() => applyTemplate(tpl)} onLongPress={() => removeTemplate(tpl.id)} style={styles.tplChip} testID={`est-tpl-${tpl.id}`}>
                    <Ionicons name="bookmark" size={13} color={theme.colors.primary} />
                    <Text style={styles.tplText}>{tpl.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Text style={styles.hint}>Tap to load · long-press to delete</Text>
            </>
          )}

          {showSave ? (
            <View style={styles.saveRow}>
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="Template name" placeholderTextColor={theme.colors.textMuted}
                value={tplName} onChangeText={setTplName} testID="est-tpl-name-input" autoFocus />
              <Pressable style={styles.saveTplBtn} onPress={saveTemplate} testID="est-tpl-save"><Ionicons name="checkmark" size={20} color="#fff" /></Pressable>
              <Pressable style={styles.saveTplCancel} onPress={() => setShowSave(false)}><Ionicons name="close" size={20} color={theme.colors.text} /></Pressable>
            </View>
          ) : (
            <Pressable style={styles.saveTplLink} onPress={() => setShowSave(true)} testID="est-save-template-button">
              <Ionicons name="bookmark-outline" size={15} color={theme.colors.primary} />
              <Text style={styles.addLineText}>Save current inputs as template</Text>
            </Pressable>
          )}

          {items.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Results — tap to include/exclude</Text>
              {items.map((it, i) => (
                <View key={i} style={[styles.line, selected[i] && styles.lineOn]} testID={`est-line-${i}`}>
                  <Pressable onPress={() => setSelected({ ...selected, [i]: !selected[i] })} testID={`est-line-toggle-${i}`}>
                    <Ionicons name={selected[i] ? "checkbox" : "square-outline"} size={20} color={selected[i] ? theme.colors.primary : theme.colors.textMuted} />
                  </Pressable>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.lineDesc}>{it.description}</Text>
                    <View style={styles.rateRow}>
                      <Text style={styles.lineMeta}>{it.quantity} {it.unit} @ $</Text>
                      <TextInput style={styles.rateInput} keyboardType="numeric" value={rateStr[i] ?? ""}
                        onChangeText={(v) => editRate(i, v)} testID={`est-rate-input-${i}`} />
                    </View>
                  </View>
                  <Text style={styles.lineTotal}>{money(it.line_total)}</Text>
                </View>
              ))}

              {assumptions && (
                <View style={styles.assume} testID="est-assumptions">
                  <Text style={styles.assumeTitle}>Assumptions used</Text>
                  {Object.entries(assumptions).map(([k, v]) => (
                    <Text key={k} style={styles.assumeText}>· {k.replace(/_/g, " ")}: {String(v)}</Text>
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>

        {items.length > 0 && (
          <View style={styles.footer}>
            <View>
              <Text style={styles.footerLabel}>Selected total</Text>
              <Text style={styles.footerTotal}>{money(total)}</Text>
            </View>
            <Pressable style={styles.addBtn} onPress={addSelected} testID="est-add-button">
              <Text style={styles.addText}>Add to Quote</Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg, paddingTop: Platform.OS === "ios" ? 44 : 24 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  title: { color: theme.colors.text, fontSize: 17, fontWeight: "800" },
  label: { color: theme.colors.textMuted, fontSize: 12, fontWeight: "700", marginBottom: 6, marginTop: 8 },
  tchip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, height: 40, borderRadius: 20, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, flexShrink: 0 },
  tchipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  tchipText: { color: theme.colors.textMuted, fontWeight: "700", fontSize: 13 },
  inputsRow: { flexDirection: "row", marginTop: 4 },
  input: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.md, height: 48, color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.border },
  calcBtn: { flexDirection: "row", gap: 8, backgroundColor: theme.colors.primary, height: 52, borderRadius: theme.radius.md, alignItems: "center", justifyContent: "center", marginTop: theme.spacing.md },
  calcText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  error: { color: theme.colors.danger, fontSize: 13, marginTop: 8 },
  hint: { color: theme.colors.textMuted, fontSize: 11, marginTop: 4, fontStyle: "italic" },
  tplChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, height: 34, borderRadius: 17, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.primary, flexShrink: 0 },
  tplText: { color: theme.colors.text, fontWeight: "600", fontSize: 12 },
  saveRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: theme.spacing.md },
  saveTplBtn: { width: 48, height: 48, borderRadius: theme.radius.md, backgroundColor: theme.colors.primary, alignItems: "center", justifyContent: "center" },
  saveTplCancel: { width: 48, height: 48, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  saveTplLink: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: theme.spacing.md },
  addLineText: { color: theme.colors.primary, fontWeight: "700", fontSize: 13 },
  rateRow: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  rateInput: { minWidth: 60, height: 30, backgroundColor: theme.colors.surfaceAlt, borderRadius: 6, paddingHorizontal: 8, color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.border, fontSize: 12, marginLeft: 2 },
  sectionTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "700", marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm },
  line: { flexDirection: "row", alignItems: "center", backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 8, opacity: 0.55 },
  lineOn: { opacity: 1, borderColor: theme.colors.primary },
  lineDesc: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
  lineMeta: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  lineTotal: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },
  assume: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, padding: theme.spacing.md, marginTop: 8 },
  assumeTitle: { color: theme.colors.textMuted, fontSize: 12, fontWeight: "800", marginBottom: 6, textTransform: "uppercase" },
  assumeText: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  footer: { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: theme.spacing.md, paddingBottom: theme.spacing.lg, backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.border },
  footerLabel: { color: theme.colors.textMuted, fontSize: 12 },
  footerTotal: { color: theme.colors.primary, fontSize: 20, fontWeight: "800" },
  addBtn: { backgroundColor: theme.colors.primary, paddingHorizontal: theme.spacing.xl, height: 50, borderRadius: theme.radius.md, alignItems: "center", justifyContent: "center" },
  addText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
