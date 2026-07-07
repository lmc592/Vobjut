import { useCallback, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, Modal, ScrollView, FlatList,
  RefreshControl, TextInput,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";
import { StatusBadge, EmptyState, Fab, money } from "@/src/components/ui";
import Estimator from "@/src/components/Estimator";

const KIND_FOR_CATEGORY: Record<string, string> = {
  Materials: "material", Labour: "labour", Equipment: "equipment",
};
const QUOTE_NEXT: Record<string, string> = { DRAFT: "SENT", SENT: "ACCEPTED" };
const QUOTE_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"];

export default function Quotes() {
  const insets = useSafeAreaInsets();
  const [quotes, setQuotes] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [rates, setRates] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [builder, setBuilder] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);

  // builder state
  const [title, setTitle] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [overhead, setOverhead] = useState("10");
  const [profit, setProfit] = useState("15");
  const [contingency, setContingency] = useState("5");
  const [recommendation, setRecommendation] = useState("");
  const [rateModal, setRateModal] = useState(false);
  const [estimatorOpen, setEstimatorOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [q, c, r] = await Promise.all([api("/quotes"), api("/customers"), api("/pricing-rates")]);
      setQuotes(q); setCustomers(c); setRates(r);
    } catch {}
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  const preview = useMemo(() => {
    const buckets: any = { materials: 0, labour: 0, equipment: 0, subcontractors: 0, delivery: 0, waste: 0 };
    const map: any = { material: "materials", labour: "labour", equipment: "equipment", subcontractor: "subcontractors", delivery: "delivery", waste: "waste" };
    items.forEach((it) => { buckets[map[it.kind] || "materials"] += it.quantity * it.unit_rate; });
    const direct = Object.values(buckets).reduce((a: number, b: any) => a + b, 0) as number;
    const cont = direct * (parseFloat(contingency) || 0) / 100;
    const base = direct + cont;
    const oh = base * (parseFloat(overhead) || 0) / 100;
    const sub = base + oh;
    const pr = sub * (parseFloat(profit) || 0) / 100;
    const preGst = sub + pr;
    const gst = preGst * 0.1;
    return { direct, cont, oh, pr, gst, total: preGst + gst };
  }, [items, overhead, profit, contingency]);

  function addRate(rate: any) {
    setItems([...items, {
      description: rate.description, kind: KIND_FOR_CATEGORY[rate.category] || "material",
      quantity: 1, unit: rate.unit, unit_rate: rate.rate, pricing_rate_id: rate.id,
    }]);
    setRateModal(false);
  }

  function updateQty(idx: number, qty: string) {
    const copy = [...items];
    copy[idx].quantity = parseFloat(qty) || 0;
    setItems(copy);
  }

  function resetBuilder() {
    setTitle(""); setCustomerId(null); setItems([]); setOverhead("10"); setProfit("15"); setContingency("5"); setEditingId(null); setRecommendation("");
  }

  async function recommendMargins() {
    if (items.length === 0) return;
    try {
      const res = await api<{ contingency: number; overhead: number; profit: number; rationale: string[] }>(
        "/recommend-margins", { method: "POST", body: { items } });
      setContingency(String(res.contingency));
      setOverhead(String(res.overhead));
      setProfit(String(res.profit));
      setRecommendation(res.rationale.join(" · "));
    } catch {}
  }

  function openEditor(quote: any) {
    setEditingId(quote.id);
    setTitle(quote.title || "");
    setCustomerId(quote.customer_id || null);
    setItems((quote.items || []).map((it: any) => ({
      description: it.description, kind: it.kind, quantity: it.quantity,
      unit: it.unit, unit_rate: it.unit_rate, pricing_rate_id: it.pricing_rate_id || null,
    })));
    setOverhead(String(quote.overhead_percentage ?? 10));
    setProfit(String(quote.profit_percentage ?? 15));
    setContingency(String(quote.contingency_percentage ?? 0));
    setDetail(null);
    setBuilder(true);
  }

  async function saveQuote() {
    if (!title.trim() || items.length === 0) return;
    const body = {
      title, customer_id: customerId, items,
      contingency_percentage: parseFloat(contingency) || 0,
      overhead_percentage: parseFloat(overhead) || 0,
      profit_percentage: parseFloat(profit) || 0,
    };
    if (editingId) {
      await api(`/quotes/${editingId}`, { method: "PUT", body });
    } else {
      await api("/quotes", { method: "POST", body });
    }
    resetBuilder(); setBuilder(false); load();
  }

  async function openDetail(id: string) {
    try {
      const d = await api(`/quotes/${id}`);
      setDetail(d);
    } catch {}
  }

  async function advance(q: any) {
    const next = QUOTE_NEXT[q.status];
    if (!next) return;
    await api(`/quotes/${q.id}/status`, { method: "PATCH", body: { status: next } });
    if (detail?.id === q.id) await openDetail(q.id);
    load();
  }

  async function toJob(q: any) {
    try {
      await api(`/quotes/${q.id}/convert-to-job`, { method: "POST" });
      setDetail(null);
      load();
    } catch {}
  }

  async function setQuoteStatus(q: any, status: string) {
    if (q.status === status) return;
    await api(`/quotes/${q.id}/status`, { method: "PATCH", body: { status } });
    if (detail?.id === q.id) await openDetail(q.id);
    load();
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.title}>Quotes</Text>
      </View>

      <FlatList
        data={quotes}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 90 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
        ListEmptyComponent={<EmptyState icon="document-text-outline" title="No quotes yet" subtitle="Tap + to build a quote with live Victoria rates" />}
        renderItem={({ item }) => (
          <Pressable style={styles.card} testID={`quote-${item.id}`} onPress={() => openDetail(item.id)}>
            <View style={styles.cardTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.qnum}>{item.quote_number}</Text>
                <Text style={styles.cardTitle}>{item.title}</Text>
              </View>
              <StatusBadge status={item.status} />
            </View>
            <Text style={styles.total}>{money(item.breakdown?.final_total || 0)}</Text>
            <Text style={styles.cardMeta}>Direct {money(item.breakdown?.direct_cost || 0)} · GST {money(item.breakdown?.gst || 0)} · v{item.version} · tap to view</Text>
            <View style={styles.actions}>
              {QUOTE_NEXT[item.status] && (
                <Pressable style={styles.actBtn} onPress={() => advance(item)} testID={`quote-advance-${item.id}`}>
                  <Ionicons name="send" size={15} color={theme.colors.info} />
                  <Text style={styles.actText}>Mark {QUOTE_NEXT[item.status]}</Text>
                </Pressable>
              )}
              {item.status === "ACCEPTED" && (
                <Pressable style={styles.actBtn} onPress={() => toJob(item)} testID={`quote-tojob-${item.id}`}>
                  <Ionicons name="hammer" size={15} color={theme.colors.success} />
                  <Text style={[styles.actText, { color: theme.colors.success }]}>Convert to Job</Text>
                </Pressable>
              )}
            </View>
          </Pressable>
        )}
      />

      <Fab onPress={() => { resetBuilder(); setBuilder(true); }} testID="quote-add-button" />

      {/* Quote builder */}
      <Modal visible={builder} animationType="slide" onRequestClose={() => { resetBuilder(); setBuilder(false); }}>
        <View style={[styles.container, { paddingTop: insets.top }]}>
          <View style={styles.builderHeader}>
            <Pressable onPress={() => { resetBuilder(); setBuilder(false); }} testID="builder-close"><Ionicons name="close" size={26} color={theme.colors.text} /></Pressable>
            <Text style={styles.builderTitle}>{editingId ? "Edit Quote" : "Quote Builder"}</Text>
            <Pressable onPress={saveQuote} testID="builder-save"><Text style={styles.saveLink}>Save</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <TextInput style={styles.input} placeholder="Quote title *" placeholderTextColor={theme.colors.textMuted} value={title} onChangeText={setTitle} testID="quote-title-input" />

            <Text style={styles.label}>Customer</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
              {customers.map((c) => (
                <Pressable key={c.id} onPress={() => setCustomerId(c.id)} style={[styles.chip, customerId === c.id && styles.chipActive]}>
                  <Text style={[styles.chipText, customerId === c.id && styles.chipTextActive]}>{c.name}</Text>
                </Pressable>
              ))}
              {customers.length === 0 && <Text style={styles.cardMeta}>Add customers in CRM first (optional)</Text>}
            </ScrollView>

            <View style={styles.rowBetween}>
              <Text style={styles.label}>Line items</Text>
              <View style={{ flexDirection: "row", gap: theme.spacing.md }}>
                <Pressable style={styles.addLine} onPress={() => setEstimatorOpen(true)} testID="estimate-button">
                  <Ionicons name="calculator" size={16} color={theme.colors.primary} />
                  <Text style={styles.addLineText}>Estimate qty</Text>
                </Pressable>
                <Pressable style={styles.addLine} onPress={() => setRateModal(true)} testID="add-line-button">
                  <Ionicons name="add" size={16} color={theme.colors.primary} />
                  <Text style={styles.addLineText}>Add rate</Text>
                </Pressable>
              </View>
            </View>

            {items.map((it, idx) => (
              <View key={idx} style={styles.lineItem} testID={`line-item-${idx}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lineDesc}>{it.description}</Text>
                  <Text style={styles.lineMeta}>{money(it.unit_rate)}/{it.unit} · {it.kind}</Text>
                </View>
                <TextInput style={styles.qtyInput} value={String(it.quantity)} onChangeText={(t) => updateQty(idx, t)} keyboardType="numeric" testID={`qty-input-${idx}`} />
                <Text style={styles.lineTotal}>{money(it.quantity * it.unit_rate)}</Text>
                <Pressable onPress={() => setItems(items.filter((_, i) => i !== idx))}><Ionicons name="trash" size={18} color={theme.colors.danger} /></Pressable>
              </View>
            ))}

            <View style={styles.rowBetween}>
              <Text style={styles.label}>Margins</Text>
              <Pressable style={styles.addLine} onPress={recommendMargins} testID="recommend-margins-button">
                <Ionicons name="sparkles" size={16} color={theme.colors.primary} />
                <Text style={styles.addLineText}>Recommend %</Text>
              </Pressable>
            </View>
            {!!recommendation && (
              <View style={styles.recommendBox} testID="recommendation-text">
                <Ionicons name="bulb" size={14} color={theme.colors.warning} />
                <Text style={styles.recommendText}>{recommendation}</Text>
              </View>
            )}
            <View style={styles.rowBetween}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.label}>Contingency %</Text>
                <TextInput style={styles.input} value={contingency} onChangeText={setContingency} keyboardType="numeric" testID="contingency-input" />
              </View>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.label}>Overhead %</Text>
                <TextInput style={styles.input} value={overhead} onChangeText={setOverhead} keyboardType="numeric" testID="overhead-input" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Profit %</Text>
                <TextInput style={styles.input} value={profit} onChangeText={setProfit} keyboardType="numeric" testID="profit-input" />
              </View>
            </View>

            <View style={styles.breakdown} testID="quote-breakdown">
              <Row l="Direct Costs" v={money(preview.direct)} />
              <Row l={`Contingency (${contingency}%)`} v={money(preview.cont)} />
              <Row l={`Overheads (${overhead}%)`} v={money(preview.oh)} />
              <Row l={`Profit (${profit}%)`} v={money(preview.pr)} />
              <Row l="GST (10%)" v={money(preview.gst)} />
              <View style={styles.divider} />
              <Row l="Final Total" v={money(preview.total)} bold />
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Rate picker */}
      <Modal visible={rateModal} animationType="slide" transparent onRequestClose={() => setRateModal(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Victoria Pricing Rates</Text>
            <FlatList
              data={rates}
              keyExtractor={(i) => i.id}
              renderItem={({ item }) => (
                <Pressable style={styles.rateRow} onPress={() => addRate(item)} testID={`rate-${item.id}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rateDesc}>{item.description}</Text>
                    <Text style={styles.lineMeta}>{item.trade} · {item.category}</Text>
                  </View>
                  <Text style={styles.ratePrice}>{money(item.rate)}/{item.unit}</Text>
                </Pressable>
              )}
            />
            <Pressable style={styles.cancelBtn} onPress={() => setRateModal(false)}><Text style={styles.cancelText}>Close</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Estimator
        visible={estimatorOpen}
        onClose={() => setEstimatorOpen(false)}
        onAdd={(lines) => setItems((prev) => [...prev, ...lines])}
      />

      {/* Quote detail viewer */}
      <Modal visible={!!detail} animationType="slide" onRequestClose={() => setDetail(null)}>
        <View style={[styles.container, { paddingTop: insets.top }]}>
          <View style={styles.builderHeader}>
            <Pressable onPress={() => setDetail(null)} testID="quote-detail-close"><Ionicons name="close" size={26} color={theme.colors.text} /></Pressable>
            <Text style={styles.builderTitle}>{detail?.quote_number}</Text>
            <View style={{ width: 26 }} />
          </View>
          {detail && (
            <ScrollView contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 40 }} testID="quote-detail-view">
              <View style={styles.rowBetween}>
                <Text style={[styles.cardTitle, { fontSize: 18, flex: 1, marginRight: 8 }]}>{detail.title}</Text>
                <StatusBadge status={detail.status} />
              </View>
              <Text style={styles.total}>{money(detail.breakdown?.final_total || 0)}</Text>

              <Text style={[styles.label, { marginTop: theme.spacing.md }]}>Line items ({detail.items?.length || 0})</Text>
              {(detail.items || []).map((it: any, idx: number) => (
                <View key={idx} style={styles.lineItem} testID={`detail-item-${idx}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lineDesc}>{it.description}</Text>
                    <Text style={styles.lineMeta}>{it.quantity} {it.unit} @ {money(it.unit_rate)} · {it.kind}</Text>
                  </View>
                  <Text style={styles.lineTotal}>{money(it.line_total || it.quantity * it.unit_rate)}</Text>
                </View>
              ))}

              <View style={styles.breakdown}>
                <Row l="Direct Costs" v={money(detail.breakdown?.direct_cost || 0)} />
                <Row l={`Contingency (${detail.contingency_percentage ?? 0}%)`} v={money(detail.breakdown?.contingency || 0)} />
                <Row l={`Overheads (${detail.overhead_percentage}%)`} v={money(detail.breakdown?.overheads || 0)} />
                <Row l={`Profit (${detail.profit_percentage}%)`} v={money(detail.breakdown?.profit || 0)} />
                <Row l="GST (10%)" v={money(detail.breakdown?.gst || 0)} />
                <View style={styles.divider} />
                <Row l="Final Total" v={money(detail.breakdown?.final_total || 0)} bold />
              </View>

              {detail.valid_until && (
                <Text style={styles.cardMeta}>Valid until {new Date(detail.valid_until).toLocaleDateString("en-AU")}</Text>
              )}

              {(detail.versions?.length || 0) > 0 && (
                <>
                  <Text style={[styles.label, { marginTop: theme.spacing.md }]}>Version history</Text>
                  {detail.versions.map((v: any) => (
                    <View key={v.id} style={styles.versionRow}>
                      <Text style={styles.lineDesc}>v{v.version}</Text>
                      <Text style={styles.lineMeta}>{money(v.breakdown?.final_total || 0)}</Text>
                    </View>
                  ))}
                </>
              )}

              <Text style={[styles.label, { marginTop: theme.spacing.md }]}>Adjust status</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                {QUOTE_STATUSES.map((s) => (
                  <Pressable key={s} onPress={() => setQuoteStatus(detail, s)} style={[styles.chip, detail.status === s && styles.chipActive]} testID={`detail-status-${s}`}>
                    <Text style={[styles.chipText, detail.status === s && styles.chipTextActive]}>{s}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.sm }}>
                {(detail.status === "DRAFT" || detail.status === "SENT") && (
                  <Pressable style={styles.detailAction} onPress={() => openEditor(detail)} testID="detail-edit">
                    <Ionicons name="create" size={16} color="#fff" />
                    <Text style={styles.detailActionText}>Edit Quote (adjust items & margins)</Text>
                  </Pressable>
                )}
                {detail.status === "ACCEPTED" && (
                  <Pressable style={[styles.detailAction, { backgroundColor: theme.colors.success }]} onPress={() => toJob(detail)} testID="detail-tojob">
                    <Ionicons name="hammer" size={16} color="#fff" />
                    <Text style={styles.detailActionText}>Convert to Job</Text>
                  </Pressable>
                )}
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

function Row({ l, v, bold }: any) {
  return (
    <View style={styles.brow}>
      <Text style={[styles.blabel, bold && { color: theme.colors.text, fontWeight: "800", fontSize: 16 }]}>{l}</Text>
      <Text style={[styles.bval, bold && { fontSize: 18, color: theme.colors.primary }]}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  header: { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  title: { color: theme.colors.text, fontSize: 22, fontWeight: "800" },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border, marginBottom: theme.spacing.sm },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  qnum: { color: theme.colors.textMuted, fontSize: 11, fontWeight: "700" },
  cardTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "700", marginTop: 2 },
  total: { color: theme.colors.primary, fontSize: 22, fontWeight: "800", marginTop: 6 },
  cardMeta: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  actions: { flexDirection: "row", gap: theme.spacing.lg, marginTop: theme.spacing.sm, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: theme.spacing.sm },
  actBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  actText: { color: theme.colors.info, fontSize: 13, fontWeight: "600" },
  builderHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  builderTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "800" },
  saveLink: { color: theme.colors.primary, fontSize: 16, fontWeight: "700" },
  input: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.md, height: 48, color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.border, marginBottom: theme.spacing.sm },
  label: { color: theme.colors.textMuted, fontSize: 12, fontWeight: "700", marginBottom: 6, marginTop: 6 },
  chip: { paddingHorizontal: 14, height: 36, borderRadius: 18, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { color: theme.colors.textMuted, fontWeight: "600", fontSize: 13 },
  chipTextActive: { color: "#fff" },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  addLine: { flexDirection: "row", alignItems: "center", gap: 2 },
  addLineText: { color: theme.colors.primary, fontWeight: "700", fontSize: 13 },
  lineItem: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.sm, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 6 },
  lineDesc: { color: theme.colors.text, fontSize: 13, fontWeight: "600" },
  lineMeta: { color: theme.colors.textMuted, fontSize: 11, marginTop: 2 },
  qtyInput: { width: 52, height: 38, backgroundColor: theme.colors.surfaceAlt, borderRadius: 8, textAlign: "center", color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.border },
  lineTotal: { color: theme.colors.text, fontSize: 13, fontWeight: "700", width: 78, textAlign: "right" },
  breakdown: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border, marginTop: theme.spacing.md },
  brow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  blabel: { color: theme.colors.textMuted, fontSize: 14 },
  bval: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
  divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: 6 },
  recommendBox: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.colors.warning + "18", borderRadius: theme.radius.sm, padding: theme.spacing.sm, marginBottom: theme.spacing.sm },
  recommendText: { color: theme.colors.text, fontSize: 12, flex: 1 },
  versionRow: { flexDirection: "row", justifyContent: "space-between", backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 6 },
  detailAction: { flexDirection: "row", gap: 8, backgroundColor: theme.colors.primary, height: 50, borderRadius: theme.radius.md, alignItems: "center", justifyContent: "center" },
  detailActionText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  modalWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radius.xl, borderTopRightRadius: theme.radius.xl, padding: theme.spacing.lg, maxHeight: "80%" },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.border, alignSelf: "center", marginBottom: theme.spacing.md },
  sheetTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "800", marginBottom: theme.spacing.md },
  rateRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  rateDesc: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
  ratePrice: { color: theme.colors.primary, fontSize: 13, fontWeight: "700" },
  cancelBtn: { height: 48, borderRadius: theme.radius.md, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surfaceAlt, marginTop: theme.spacing.md },
  cancelText: { color: theme.colors.text, fontWeight: "700" },
});
