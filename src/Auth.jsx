import React, { useState } from "react";
import { Landmark, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "./lib/supabaseClient";

export default function Auth() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          setInfo("Cuenta creada. Revisa tu correo para confirmar antes de entrar.");
        }
      }
    } catch (err) {
      setError(traducirError(err.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell">
      <style>{AUTH_CSS}</style>
      <div className="auth-card">
        <div className="auth-brand">
          <Landmark size={22} />
          <span>ContaSoft Nube</span>
        </div>
        <p className="auth-sub">{mode === "login" ? "Ingresa a tu contabilidad" : "Crea tu cuenta gratis"}</p>

        <form onSubmit={submit} className="auth-form">
          <label>
            Correo
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tucorreo@ejemplo.com" />
          </label>
          <label>
            Contraseña
            <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" />
          </label>

          {error && (
            <p className="auth-msg auth-error">
              <AlertTriangle size={14} /> {error}
            </p>
          )}
          {info && (
            <p className="auth-msg auth-info">
              <CheckCircle2 size={14} /> {info}
            </p>
          )}

          <button className="auth-btn" disabled={loading} type="submit">
            {loading ? <Loader2 size={16} className="spin" /> : mode === "login" ? "Entrar" : "Crear cuenta"}
          </button>
        </form>

        <button
          className="auth-switch"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError("");
            setInfo("");
          }}
        >
          {mode === "login" ? "¿No tienes cuenta? Regístrate" : "¿Ya tienes cuenta? Inicia sesión"}
        </button>
      </div>
    </div>
  );
}

function traducirError(msg) {
  if (!msg) return "Ocurrió un error. Intenta de nuevo.";
  if (msg.includes("Invalid login credentials")) return "Correo o contraseña incorrectos.";
  if (msg.includes("User already registered")) return "Ya existe una cuenta con ese correo. Inicia sesión.";
  if (msg.includes("Password should be at least")) return "La contraseña debe tener al menos 6 caracteres.";
  return msg;
}

const AUTH_CSS = `
.auth-shell{ min-height:100vh; display:flex; align-items:center; justify-content:center; background:#F6F3EA; font-family:'Inter',sans-serif; padding:20px; }
.auth-card{ background:#fff; border:1px solid #D8D0B8; border-radius:12px; padding:32px 30px; width:100%; max-width:360px; box-shadow:0 6px 24px rgba(27,46,53,.08); }
.auth-brand{ display:flex; align-items:center; gap:8px; font-family:'Source Serif 4',serif; font-weight:700; font-size:19px; color:#1B2E35; }
.auth-sub{ font-size:13px; color:#5B6A6E; margin:6px 0 20px; }
.auth-form{ display:flex; flex-direction:column; gap:14px; }
.auth-form label{ display:flex; flex-direction:column; gap:6px; font-size:12.5px; color:#5B6A6E; }
.auth-form input{ font-family:'Inter',sans-serif; font-size:13.5px; padding:9px 11px; border:1px solid #D8D0B8; border-radius:6px; background:#FCFBF6; color:#1B2E35; }
.auth-form input:focus{ outline:2px solid #A67C3D; outline-offset:1px; }
.auth-msg{ display:flex; gap:6px; align-items:flex-start; font-size:12.5px; margin:0; }
.auth-error{ color:#B23A2F; }
.auth-info{ color:#2F6F4E; }
.auth-btn{ margin-top:4px; background:#1B2E35; color:#F6F3EA; border:none; border-radius:6px; padding:10px; font-weight:600; font-size:13.5px; cursor:pointer; display:flex; align-items:center; justify-content:center; }
.auth-btn:hover{ background:#0f1c21; }
.auth-btn:disabled{ opacity:.7; cursor:default; }
.auth-switch{ margin-top:16px; background:none; border:none; color:#A67C3D; font-size:12.5px; cursor:pointer; width:100%; text-align:center; }
.spin{ animation:spin 1s linear infinite; }
@keyframes spin{ to{ transform:rotate(360deg); } }
`;
