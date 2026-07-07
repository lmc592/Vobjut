import { useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/context/AuthContext";
import { theme } from "@/src/theme";

export default function Login() {
  const { login, register } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [abn, setAbn] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError("");
    setBusy(true);
    try {
      if (mode === "login") {
        await login(email.trim(), password);
      } else {
        await register({ company_name: company.trim(), name: name.trim(), email: email.trim(), password, abn: abn.trim() });
      }
      router.replace("/(tabs)");
    } catch (e: any) {
      setError(e.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors.bg }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.logoWrap}>
          <View style={styles.logoBox}><Ionicons name="construct" size={32} color="#fff" /></View>
          <Text style={styles.brand}>CONTRACTOR OS</Text>
          <Text style={styles.tagline}>Field & office management for Victorian trades</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>{mode === "login" ? "Welcome back" : "Create your account"}</Text>

          {mode === "register" && (
            <>
              <Field label="Company name" value={company} onChange={setCompany} placeholder="ACME Concreting" testID="reg-company-input" />
              <Field label="Your name" value={name} onChange={setName} placeholder="Jane Smith" testID="reg-name-input" />
              <Field label="ABN (optional)" value={abn} onChange={setAbn} placeholder="12 345 678 901" testID="reg-abn-input" />
            </>
          )}
          <Field label="Email" value={email} onChange={setEmail} placeholder="you@company.com.au" keyboardType="email-address" testID="email-input" />
          <Field label="Password" value={password} onChange={setPassword} placeholder="••••••••" secure testID="password-input" />

          {!!error && <Text style={styles.error} testID="auth-error">{error}</Text>}

          <Pressable style={styles.btn} onPress={submit} disabled={busy} testID="auth-submit-button">
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>{mode === "login" ? "Sign In" : "Create Account"}</Text>}
          </Pressable>

          <Pressable onPress={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }} testID="toggle-mode-button" style={styles.toggle}>
            <Text style={styles.toggleText}>
              {mode === "login" ? "New here? Create a company account" : "Already have an account? Sign in"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, value, onChange, placeholder, secure, keyboardType, testID }: any) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        secureTextEntry={secure}
        autoCapitalize={keyboardType === "email-address" ? "none" : "sentences"}
        keyboardType={keyboardType}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: theme.spacing.lg, flexGrow: 1 },
  logoWrap: { alignItems: "center", marginBottom: theme.spacing.xl },
  logoBox: { width: 64, height: 64, borderRadius: theme.radius.lg, backgroundColor: theme.colors.primary, alignItems: "center", justifyContent: "center", marginBottom: theme.spacing.md },
  brand: { color: theme.colors.text, fontSize: 22, fontWeight: "800", letterSpacing: 1 },
  tagline: { color: theme.colors.textMuted, fontSize: 13, marginTop: 4, textAlign: "center" },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.border },
  title: { color: theme.colors.text, fontSize: 18, fontWeight: "700", marginBottom: theme.spacing.md },
  fieldWrap: { marginBottom: theme.spacing.md },
  label: { color: theme.colors.textMuted, fontSize: 12, marginBottom: 6, fontWeight: "600" },
  input: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.md, height: 48, color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.border },
  btn: { backgroundColor: theme.colors.primary, height: 52, borderRadius: theme.radius.md, alignItems: "center", justifyContent: "center", marginTop: theme.spacing.sm },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  toggle: { marginTop: theme.spacing.md, alignItems: "center" },
  toggleText: { color: theme.colors.primary, fontSize: 13, fontWeight: "600" },
  error: { color: theme.colors.danger, fontSize: 13, marginBottom: theme.spacing.sm },
});
