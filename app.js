"use strict";

// Each client has its own folder and its own storage; joriana keeps the original keys.
const CLIENT = document.body.dataset.client;
const PREFIX = CLIENT === "joriana" ? "cse27" : "cse27." + CLIENT;
const KEY_STORE = PREFIX + ".key";
const TRACK_STORE = PREFIX + ".suivi";
const CHAT_STORE = PREFIX + ".chat";
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const STATUSES = [
  ["appeler", "À appeler"], ["appele", "Appelé"], ["rappeler", "À rappeler"],
  ["devis", "Devis envoyé"], ["client", "Client"], ["ecarte", "Écarté"],
];
const STATUS_LABEL = Object.fromEntries(STATUSES);
const STATUS_TIP = {
  appeler: "Pas encore contacté.",
  appele: "Vous avez appelé, c'est fait.",
  rappeler: "Il faut rappeler (absent, rappel demandé…).",
  devis: "Vous avez envoyé une proposition.",
  client: "C'est signé.",
  ecarte: "Pas intéressé ou hors cible : la ligne passe en gris.",
};
const SIZE_ORDER = ["10-19", "20-49", "50-99", "100-199", "200-249", "250-499", "500-999", "1000-1999", "2000-4999", "5000-9999"];

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const today = new Date();

let ROWS = [];
let CHAT = null;
let exportScope = "all";
let printAll = false;
let GENERATED = "";
let track = JSON.parse(localStorage.getItem(TRACK_STORE) || "{}");
const state = { q: "", mois: "", secteur: "", taille: "", statut: "", canal: "", sort: "mois", dir: "asc" };

/* ---------- Unlock ---------- */

async function deriveKey(pw) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64(ENC.salt), iterations: ENC.iter, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
}

async function decrypt(key) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(ENC.iv) }, key, b64(ENC.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

async function tryStoredKey() {
  const raw = localStorage.getItem(KEY_STORE);
  if (!raw) return null;
  try {
    const key = await crypto.subtle.importKey("raw", b64(raw), "AES-GCM", true, ["decrypt"]);
    return await decrypt(key);
  } catch {
    // Data was re-encrypted with a new code: ask again.
    localStorage.removeItem(KEY_STORE);
    return null;
  }
}

async function boot() {
  const data = await tryStoredKey();
  if (data) return start(data);
  $("#lock").hidden = false;
  $("#pw").focus();
}

$("#lockForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#lockBtn");
  btn.disabled = true;
  btn.textContent = "Ouverture…";
  $("#lockErr").hidden = true;
  try {
    const key = await deriveKey($("#pw").value.trim());
    const data = await decrypt(key);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
    localStorage.setItem(KEY_STORE, btoa(String.fromCharCode(...raw)));
    $("#lock").hidden = true;
    start(data);
  } catch {
    $("#lockErr").hidden = false;
    const lock = $("#lock");
    lock.classList.remove("shake"); void lock.offsetWidth; lock.classList.add("shake");
    $("#pw").select();
  } finally {
    btn.disabled = false;
    btn.textContent = "Ouvrir la liste";
  }
});

$("#logout").addEventListener("click", () => {
  if (!confirm("Verrouiller cet appareil ? Le code sera redemandé. Votre suivi reste enregistré.")) return;
  localStorage.removeItem(KEY_STORE);
  location.reload();
});

/* ---------- Helpers ---------- */

function monthsUntil(mois) {
  const [y, m] = mois.split("-").map(Number);
  return (y - today.getFullYear()) * 12 + (m - 1 - today.getMonth());
}
function monthLabel(mois, withYear = true) {
  const [y, m] = mois.split("-").map(Number);
  return MONTHS[m - 1] + (withYear ? " " + y : "");
}
function untilLabel(mois) {
  const n = monthsUntil(mois);
  if (n <= 0) return "ce mois-ci";
  return n === 1 ? "dans 1 mois" : `dans ${n} mois`;
}
const isSoon = (mois) => monthsUntil(mois) <= 4;
const fmtTel = (t) => (t || "").replace(/^\+33/, "0").replace(/(\d{2})(?=\d)/g, "$1 ").trim();
const telHref = (t) => "tel:" + (t || "").replace(/\s/g, "");
const sizeMin = (e) => parseInt(e, 10) || 0;
const statusOf = (r) => track[r.siret]?.s || "appeler";
const noteOf = (r) => track[r.siret]?.n || "";
const siteUrl = (s) => (s ? (/^https?:/.test(s) ? s : "https://" + s) : "");
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function fmtDate(d) {
  if (!d) return "";
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) return d;
  return d.replace(/^(\d{4})-?(\d{2})-?(\d{2})$/, "$3/$2/$1");
}

function saveTrack(siret, patch) {
  track[siret] = { ...(track[siret] || {}), ...patch, t: new Date().toISOString() };
  localStorage.setItem(TRACK_STORE, JSON.stringify(track));
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove("on"), 1800);
}

async function copy(text, msg) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
  toast(msg);
}

/* ---------- Render ---------- */

function start(data) {
  ROWS = data.rows;
  GENERATED = data.generated;
  CHAT = data.chat || null;
  $("#title").innerHTML = esc(data.title || "Élections CSE 2027").replace("1er", "1<sup>er</sup>");
  document.title = (data.title || "Élections CSE 2027").replace(" · ", " · ");
  $("#app").hidden = false;
  $("#gen").textContent = fmtDate(GENERATED);

  const secteurs = [...new Set(ROWS.map((r) => r.secteur))].sort((a, b) => a.localeCompare(b, "fr"));
  $("#fSecteur").insertAdjacentHTML("beforeend", secteurs.map((s) => `<option>${esc(s)}</option>`).join(""));
  $("#fStatut").insertAdjacentHTML("beforeend", STATUSES.map(([v, l]) => `<option value="${v}">${l}</option>`).join(""));

  const first = monthsUntil("2027-01");
  $("#todayNote").textContent = first > 0
    ? `Nous sommes en ${monthLabel(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`)} : premières élections ${untilLabel("2027-01")}. En rouge, moins de 4 mois.`
    : "En rouge, élections dans moins de 4 mois.";

  render();
  initChat();
}

function filtered(all = false) {
  if (all || printAll) return [...ROWS].sort((a, b) => a.mois.localeCompare(b.mois) || a.entreprise.localeCompare(b.entreprise, "fr"));
  const q = state.q.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  let rows = ROWS.filter((r) => {
    if (state.mois && r.mois !== state.mois) return false;
    if (state.secteur && r.secteur !== state.secteur) return false;
    if (state.statut && statusOf(r) !== state.statut) return false;
    if (state.canal && !r[state.canal]) return false;
    if (state.taille) {
      const n = sizeMin(r.effectif);
      if (state.taille === "s" && n >= 100) return false;
      if (state.taille === "m" && (n < 100 || n >= 500)) return false;
      if (state.taille === "l" && n < 500) return false;
    }
    if (q && !norm([r.entreprise, r.ville, r.cp, r.dirigeant, r.secteur, r.siret].join(" ")).includes(q)) return false;
    return true;
  });
  const k = state.sort, d = state.dir === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    const va = a[k], vb = b[k];
    const c = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "fr");
    return c * d || a.entreprise.localeCompare(b.entreprise, "fr");
  });
  return rows;
}

function renderMonths() {
  const counts = {};
  ROWS.forEach((r) => (counts[r.mois] = (counts[r.mois] || 0) + 1));
  const max = Math.max(...Object.values(counts));
  const keys = ["2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06"];
  $("#months").innerHTML = keys.map((m) => {
    const n = counts[m] || 0;
    return `<button class="month ${isSoon(m) ? "soon" : ""}" data-m="${m}" aria-pressed="${state.mois === m}"
      aria-label="${capital(monthLabel(m))} : ${n} établissements"
      data-tip="${n} établissement${n > 1 ? "s" : ""} devrai${n > 1 ? "ent" : "t"} réélire leur CSE en ${monthLabel(m)}, ${untilLabel(m)}.${isSoon(m) ? " C'est bientôt : le moment d'appeler." : ""} ${state.mois === m ? "Cliquez pour tout réafficher." : "Cliquez pour ne voir que ce mois."}">
      <span class="m-name">${capital(monthLabel(m, false))}</span>
      <span class="m-count">${n}<small>étab.</small></span>
      <span class="m-bar"><i style="transform:scaleX(${n / max})"></i></span>
      <span class="m-when">${untilLabel(m)}</span>
    </button>`;
  }).join("");
}

function renderSummary(rows) {
  const soon = ROWS.filter((r) => isSoon(r.mois)).length;
  const toCall = ROWS.filter((r) => statusOf(r) === "appeler").length;
  const reach = ROWS.filter((r) => r.tel).length;
  $("#summary").innerHTML =
    `<span data-tip="Nombre total d'établissements dans votre liste."><b>${ROWS.length}</b> établissements</span> · <span data-tip="Établissements dont l'élection est estimée dans les 4 prochains mois : à contacter en priorité."><b class="hot">${soon}</b> votent dans moins de 4 mois</span> · <span data-tip="Établissements dont on a trouvé le numéro du standard."><b>${reach}</b> avec standard</span> · <span data-tip="Établissements que vous n'avez pas encore marqués dans « Mon suivi »."><b>${toCall}</b> encore à appeler</span>`;
  $("#exportSelLabel").textContent = `Exporter l'affichage (${rows.length})`;
  $("#exportAllLabel").textContent = `Tout exporter (${ROWS.length})`;
  $("#exportSel").hidden = rows.length === ROWS.length;
}

function statusSelect(r) {
  const s = statusOf(r);
  return `<select class="status" data-s="${s}" data-siret="${r.siret}" aria-label="Mon suivi pour ${esc(r.entreprise)}" data-tip="Votre note perso : où en êtes-vous avec cet établissement ? Rien n'est envoyé, c'est juste pour vous.">
    ${STATUSES.map(([v, l]) => `<option value="${v}" ${v === s ? "selected" : ""}>${l}</option>`).join("")}
  </select>`;
}

function render() {
  const rows = filtered();
  renderMonths();
  renderSummary(rows);
  const active = state.q || state.mois || state.secteur || state.taille || state.statut || state.canal;
  $("#reset").hidden = !active;
  document.querySelectorAll(".sort").forEach((b) => b.dataset.dir = b.dataset.sort === state.sort ? state.dir : "");

  $("#rows").innerHTML = rows.map((r) => {
    const s = statusOf(r);
    return `<tr data-siret="${r.siret}" class="${s === "ecarte" || s === "client" ? "is-dim" : ""}" tabindex="0">
      <td class="c-when"><div class="when ${isSoon(r.mois) ? "soon" : ""}" data-tip="Élection estimée en ${monthLabel(r.mois)} (dernier vote le ${fmtDate(r.scrutin)} + mandat de ${r.mandat || 4} ans)."><b>${capital(monthLabel(r.mois))}</b><span>${untilLabel(r.mois)}</span></div></td>
      <td class="c-co"><div class="co" data-tip="Cliquez sur la ligne pour ouvrir la fiche complète : contacts, notes, rappel agenda."><b>${esc(r.entreprise)}</b><span>${esc(capital(r.ville.toLowerCase()))} · ${esc(r.secteur)}</span></div></td>
      <td class="c-size num" data-tip="${r.inscrits} salariés inscrits pour voter au CSE · effectif ${esc(r.effectif)} salariés.">${r.inscrits}<span class="size">${esc(r.effectif)} sal.</span></td>
      <td class="c-tel">${r.tel
        ? `<span class="tel"><a class="mono" href="${telHref(r.tel)}" data-tip="Cliquez pour appeler (sur téléphone ou avec votre logiciel d'appel). Demandez le ou la secrétaire du CSE.">${fmtTel(r.tel)}</a><button class="mini" data-copy="${r.tel}" aria-label="Copier le numéro" data-tip="Copier le numéro"><svg class="ic"><use href="#i-copy"/></svg></button></span>`
        : `<span class="none" data-tip="Numéro non trouvé : ouvrez la fiche pour l'email ou le site.">Pas de standard</span>`}</td>
      <td class="c-st">${statusSelect(r)}</td>
    </tr>`;
  }).join("");
  $("#empty").hidden = rows.length > 0;
  $("#table").hidden = rows.length === 0;
}

/* ---------- Detail panel ---------- */

function openPanel(siret) {
  const r = ROWS.find((x) => x.siret === siret);
  if (!r) return;
  const s = statusOf(r);
  const subject = encodeURIComponent("Élection de votre CSE en " + monthLabel(r.mois));
  const maps = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(r.adresse || `${r.entreprise} ${r.ville}`);
  const line = `${r.entreprise}, ${capital(r.ville.toLowerCase())}, élection CSE estimée ${monthLabel(r.mois)}${r.tel ? ", standard " + fmtTel(r.tel) : ""}`;
  $("#panelBody").innerHTML = `
    <div class="p-head">
      <div><h2 id="pTitle">${esc(r.entreprise)}</h2><p>${esc(capital(r.ville.toLowerCase()))} · ${esc(r.secteur)}</p></div>
      <button class="btn icon" data-close aria-label="Fermer" data-tip="Fermer la fiche (touche Échap)"><svg class="ic"><use href="#i-x"/></svg></button>
    </div>
    <div class="p-date ${isSoon(r.mois) ? "soon" : ""}">
      <b>Élection estimée : ${monthLabel(r.mois)}</b>
      <span>${capital(untilLabel(r.mois))} · dernier scrutin le ${fmtDate(r.scrutin)}${r.mandat ? `, mandat de ${r.mandat} ans` : ""}</span>
    </div>
    <div class="p-sec">
      <h3 data-tip="Une simple note pour vous souvenir de ce qui est fait ou pas. Rien n'est envoyé à l'entreprise ni à personne.">Mon suivi <span class="muted" style="font-weight:400">· note perso, visible par vous seul</span></h3>
      <div class="seg" role="group" aria-label="Mon suivi">
        ${STATUSES.map(([v, l]) => `<button data-st="${v}" aria-pressed="${v === s}" data-tip="${STATUS_TIP[v]}">${l}</button>`).join("")}
      </div>
    </div>
    <div class="p-sec">
      <h3>Joindre l'entreprise</h3>
      <div class="p-rows">
        ${r.tel ? `<div class="p-row"><svg class="ic"><use href="#i-phone"/></svg><span class="v"><a class="mono" href="${telHref(r.tel)}" data-tip="Cliquez pour appeler le standard.">${fmtTel(r.tel)}</a> <span class="muted">standard</span></span><button class="mini" data-copy="${r.tel}" aria-label="Copier le numéro" data-tip="Copier le numéro"><svg class="ic"><use href="#i-copy"/></svg></button></div>` : ""}
        ${r.email ? `<div class="p-row"><svg class="ic"><use href="#i-mail"/></svg><span class="v"><a href="mailto:${esc(r.email)}?subject=${subject}" data-tip="Ouvre votre messagerie avec un objet déjà rempli.">${esc(r.email)}</a></span><button class="mini" data-copy="${esc(r.email)}" aria-label="Copier l'email" data-tip="Copier l'email"><svg class="ic"><use href="#i-copy"/></svg></button></div>` : ""}
        ${r.site ? `<div class="p-row"><svg class="ic"><use href="#i-globe"/></svg><span class="v"><a href="${esc(siteUrl(r.site))}" target="_blank" rel="noopener" data-tip="Ouvre le site de l'entreprise dans un nouvel onglet.">${esc(r.site)}</a></span></div>` : ""}
        ${r.adresse ? `<div class="p-row"><svg class="ic"><use href="#i-pin"/></svg><span class="v"><a href="${maps}" target="_blank" rel="noopener" data-tip="Voir l'adresse sur Google Maps.">${esc(r.adresse)}</a></span><button class="mini" data-copy="${esc(r.adresse)}" aria-label="Copier l'adresse" data-tip="Copier l'adresse"><svg class="ic"><use href="#i-copy"/></svg></button></div>` : ""}
      </div>
      <p class="muted" style="font-size:.8125rem;margin-top:.5rem">Au standard, demandez le ou la secrétaire du CSE.</p>
    </div>
    <div class="p-sec">
      <h3>Établissement</h3>
      <dl class="facts">
        <dt data-tip="Salariés inscrits pour voter à la dernière élection du CSE.">Électeurs inscrits</dt><dd>${r.inscrits}</dd>
        <dt>Effectif</dt><dd>${esc(r.effectif)} salariés</dd>
        ${r.dirigeant ? `<dt data-tip="Dirigeant déclaré au registre officiel des entreprises (donnée publique).">Dirigeant publié</dt><dd>${esc(r.dirigeant)}</dd>` : ""}
        <dt data-tip="Code officiel de l'activité principale de l'entreprise.">Code NAF</dt><dd>${esc(r.naf)}</dd>
        <dt data-tip="Identifiant officiel de l'établissement (14 chiffres).">SIRET</dt><dd class="mono">${r.siret.replace(/(\d{3})(\d{3})(\d{3})(\d{5})/, "$1 $2 $3 $4")}</dd>
      </dl>
    </div>
    <div class="p-sec">
      <h3><label for="note" data-tip="Vos notes perso, enregistrées sur cet appareil et incluses dans vos exports.">Notes</label></h3>
      <textarea id="note" placeholder="Nom du ou de la secrétaire, date de rappel, ce qui a été dit…">${esc(noteOf(r))}</textarea>
      <p class="saved" id="saved" aria-live="polite"></p>
    </div>
    <div class="p-links">
      <button class="btn" data-copy="${esc(line)}" data-tip="Copie un résumé en une ligne : nom, ville, mois d'élection, standard."><svg class="ic"><use href="#i-copy"/></svg>Copier la fiche</button>
      <button class="btn" data-ics="${r.siret}" data-tip="Télécharge un rappel pour votre agenda, un mois avant l'élection."><svg class="ic"><use href="#i-cal"/></svg>Rappel agenda</button>
      <a class="btn" href="https://annuaire-entreprises.data.gouv.fr/etablissement/${r.siret}" target="_blank" rel="noopener" data-tip="Fiche publique de l'établissement sur l'annuaire officiel de l'État."><svg class="ic"><use href="#i-ext"/></svg>Fiche officielle</a>
    </div>`;
  const panel = $("#panel");
  panel.dataset.siret = siret;
  if (!panel.open) panel.showModal();

  let h;
  $("#note").addEventListener("input", (e) => {
    clearTimeout(h);
    h = setTimeout(() => { saveTrack(siret, { n: e.target.value }); $("#saved").textContent = "Note enregistrée sur cet appareil"; }, 400);
  });
}

$("#panel").addEventListener("click", (e) => {
  if (e.target === e.currentTarget || e.target.closest("[data-close]")) return $("#panel").close();
  const st = e.target.closest("[data-st]");
  if (st) {
    const siret = $("#panel").dataset.siret;
    saveTrack(siret, { s: st.dataset.st });
    document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", b === st));
    render();
    toast("Suivi : " + STATUS_LABEL[st.dataset.st]);
  }
  const ics = e.target.closest("[data-ics]");
  if (ics) download(buildIcs(ROWS.filter((r) => r.siret === ics.dataset.ics)), "rappel-cse.ics", "text/calendar");
});

/* ---------- Events ---------- */

document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-copy]");
  if (c) { e.stopPropagation(); return copy(c.dataset.copy, "Copié"); }
  if (e.target.closest("a")) return;
  const m = e.target.closest(".month");
  if (m) { state.mois = state.mois === m.dataset.m ? "" : m.dataset.m; return render(); }
  const sort = e.target.closest(".sort");
  if (sort) {
    const k = sort.dataset.sort;
    state.dir = state.sort === k && state.dir === "asc" ? "desc" : "asc";
    state.sort = k;
    return render();
  }
  const tr = e.target.closest("tbody tr");
  if (tr && !e.target.closest("select")) openPanel(tr.dataset.siret);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches("tbody tr")) openPanel(e.target.dataset.siret);
  if (e.key === "/" && !e.target.matches("input, textarea, select")) { e.preventDefault(); $("#q").focus(); }
});

$("#rows").addEventListener("change", (e) => {
  if (!e.target.matches(".status")) return;
  saveTrack(e.target.dataset.siret, { s: e.target.value });
  render();
  toast("Suivi : " + STATUS_LABEL[e.target.value]);
});

$("#q").addEventListener("input", (e) => { state.q = e.target.value.trim(); render(); });
[["#fSecteur", "secteur"], ["#fTaille", "taille"], ["#fStatut", "statut"], ["#fCanal", "canal"]].forEach(([sel, k]) =>
  $(sel).addEventListener("change", (e) => { state[k] = e.target.value; render(); }));

function resetFilters() {
  Object.assign(state, { q: "", mois: "", secteur: "", taille: "", statut: "", canal: "" });
  ["#q", "#fSecteur", "#fTaille", "#fStatut", "#fCanal"].forEach((s) => ($(s).value = ""));
  render();
}
$("#reset").addEventListener("click", resetFilters);
$("#reset2").addEventListener("click", resetFilters);

$("#copyTels").addEventListener("click", () => {
  const rows = filtered().filter((r) => r.tel);
  copy(rows.map((r) => `${fmtTel(r.tel)}\t${r.entreprise}`).join("\n"), `${rows.length} numéros copiés`);
});

/* ---------- Exports ---------- */

function scopedRows() {
  return exportScope === "all" ? filtered(true) : filtered();
}

function exportRows() {
  return scopedRows().map((r) => ({
    "Élection estimée": monthLabel(r.mois),
    "Mois (AAAA-MM)": r.mois,
    "Entreprise": r.entreprise,
    "Ville": r.ville,
    "Code postal": r.cp,
    "Adresse": r.adresse,
    "Secteur": r.secteur,
    "NAF": r.naf,
    "Effectif": r.effectif,
    "Électeurs inscrits": r.inscrits,
    "Dernier scrutin": fmtDate(r.scrutin),
    "Standard": fmtTel(r.tel),
    "Email": r.email,
    "Site": r.site,
    "Dirigeant publié": r.dirigeant,
    "SIRET": r.siret,
    "Suivi": STATUS_LABEL[statusOf(r)],
    "Notes": noteOf(r),
  }));
}

function stamp() { return new Date().toISOString().slice(0, 10); }

function download(content, name, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: type + ";charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function buildCsv(rows) {
  const head = Object.keys(rows[0] || exportRows.call(null)[0] || {});
  const cell = (v) => {
    const s = String(v ?? "");
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM + semicolons: opens with correct accents in French Excel.
  return "\uFEFF" + [head.join(";"), ...rows.map((r) => head.map((h) => cell(r[h])).join(";"))].join("\r\n");
}

function vEsc(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => "\\" + c); }

function buildVcf(rows) {
  return rows.map((r) => [
    "BEGIN:VCARD", "VERSION:3.0",
    `FN:${vEsc(r.entreprise)}`, `ORG:${vEsc(r.entreprise)}`,
    r.tel && `TEL;TYPE=WORK,VOICE:${r.tel}`,
    r.email && `EMAIL;TYPE=WORK:${r.email}`,
    r.site && `URL:${siteUrl(r.site)}`,
    r.adresse && `ADR;TYPE=WORK:;;${vEsc(r.adresse)};;;;France`,
    `NOTE:${vEsc(`Élection CSE estimée ${monthLabel(r.mois)}. ${r.inscrits} électeurs. Suivi : ${STATUS_LABEL[statusOf(r)]}. ${noteOf(r)}`)}`,
    "END:VCARD",
  ].filter(Boolean).join("\r\n")).join("\r\n");
}

function buildIcs(rows) {
  // One reminder per establishment, the 1st of the month before the estimated election.
  const now = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const events = rows.map((r) => {
    let [y, m] = r.mois.split("-").map(Number);
    m -= 1; if (m === 0) { m = 12; y -= 1; }
    const d = `${y}${String(m).padStart(2, "0")}01`;
    return [
      "BEGIN:VEVENT", `UID:cse-${r.siret}-${r.mois}@haniwanice`, `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${d}`,
      `SUMMARY:${vEsc(`Appeler ${r.entreprise} (élection CSE ${monthLabel(r.mois)})`)}`,
      `DESCRIPTION:${vEsc(`Standard : ${fmtTel(r.tel) || "non trouvé"}. ${r.email ? "Email : " + r.email + ". " : ""}${r.inscrits} électeurs. ${noteOf(r)}`)}`,
      r.adresse && `LOCATION:${vEsc(r.adresse)}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:PT9H", "DESCRIPTION:Rappel CSE", "END:VALARM",
      "END:VEVENT",
    ].filter(Boolean).join("\r\n");
  });
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Hani Wanice//Calendrier CSE//FR", "CALSCALE:GREGORIAN", ...events, "END:VCALENDAR"].join("\r\n");
}

$("#exportMenu").addEventListener("click", (e) => {
  const b = e.target.closest("[data-exp]");
  if (!b) return;
  $("#exportMenu").hidePopover();
  const kind = b.dataset.exp;
  const rows = scopedRows();
  const name = `elections-cse-2027-${CLIENT}-${exportScope === "all" ? "tout" : "selection"}-${stamp()}`;
  if (!rows.length) return toast("Aucun établissement à exporter");
  if (kind === "csv") download(buildCsv(exportRows()), name + ".csv", "text/csv");
  if (kind === "json") download(JSON.stringify(exportRows(), null, 2), name + ".json", "application/json");
  if (kind === "vcf") download(buildVcf(rows), name + ".vcf", "text/vcard");
  if (kind === "ics") download(buildIcs(rows), name + ".ics", "text/calendar");
  if (kind === "print") {
    if (exportScope === "all") { printAll = true; render(); }
    return setTimeout(() => { window.print(); printAll = false; render(); }, 50);
  }
  if (kind === "emails") {
    const list = rows.filter((r) => r.email).map((r) => r.email);
    return copy(list.join("; "), list.length ? `${list.length} emails copiés` : "Aucun email dans cette sélection");
  }
  if (kind === "xlsx") {
    if (!window.XLSX) return toast("Excel se charge, réessayez dans une seconde");
    const ws = XLSX.utils.json_to_sheet(exportRows());
    ws["!cols"] = Object.keys(exportRows()[0]).map((k) => ({ wch: Math.min(40, Math.max(10, k.length + 2)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Élections CSE 2027");
    XLSX.writeFile(wb, name + ".xlsx");
  }
  toast("Fichier téléchargé");
});

// Both export buttons open the same format menu; the button decides the scope.
["#exportSel", "#exportAll"].forEach((id) => $(id).addEventListener("click", (e) => {
  exportScope = e.currentTarget.dataset.scope;
  $("#exportSel").style.anchorName = id === "#exportSel" ? "--exp" : "";
  $("#exportAll").style.anchorName = id === "#exportAll" ? "--exp" : "";
  const n = scopedRows().length;
  $("#exportNote").textContent = exportScope === "all"
    ? `Toute la liste : ${n} établissements, avec votre suivi et vos notes.`
    : `Seulement les ${n} établissements affichés, avec votre suivi et vos notes.`;
}));

/* ---------- Tooltips: plain-language help on hover and keyboard focus ---------- */

(() => {
  const tip = $("#tip");
  let cur = null, timer;
  function show(el) {
    cur = el;
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
    let x = r.left + r.width / 2 - t.width / 2;
    x = Math.max(8, Math.min(x, innerWidth - t.width - 8));
    let y = r.top - t.height - 8;
    tip.dataset.side = y < 8 ? "below" : "above";
    if (y < 8) y = r.bottom + 8;
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    tip.classList.add("on");
  }
  function hide() { cur = null; clearTimeout(timer); tip.classList.remove("on"); tip.hidden = true; }
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const el = e.target.closest("[data-tip]");
    if (el === cur) return;
    hide();
    if (el) timer = setTimeout(() => show(el), 280);
  });
  document.addEventListener("focusin", (e) => { const el = e.target.closest("[data-tip]"); if (el && e.target.matches(":focus-visible")) show(el); });
  document.addEventListener("focusout", hide);
  document.addEventListener("scroll", hide, true);
  document.addEventListener("pointerdown", hide);
  document.addEventListener("keydown", (e) => e.key === "Escape" && hide());
})();

/* ---------- Feedback chat (ntfy.sh topics, names kept inside the encrypted data) ---------- */

let chatLog = JSON.parse(localStorage.getItem(CHAT_STORE) || "[]");

function saveChat() { localStorage.setItem(CHAT_STORE, JSON.stringify(chatLog.slice(-200))); }

function renderChat() {
  const log = $("#fbLog");
  const intro = `<div class="fb-msg them"><p>Bonjour ! Ce site est fait pour vous : dites-nous ce qui marche, ce qui vous gêne ou ce que vous aimeriez y voir. Nous lisons tout et répondons ici, en général dans la journée.</p></div>`;
  log.innerHTML = intro + chatLog.map((m) =>
    `<div class="fb-msg ${m.me ? "me" : "them"}"><p>${esc(m.text)}</p><time>${new Date(m.t).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${m.me && m.fail ? " · non envoyé" : ""}</time></div>`).join("");
  log.scrollTop = log.scrollHeight;
}

function initChat() {
  if (!CHAT) return;
  $("#fbBtn").hidden = false;
  renderChat();
  const open = (v) => {
    $("#fb").hidden = !v;
    $("#fbBtn").setAttribute("aria-expanded", v);
    $(".fb-dot").hidden = true;
    if (v) { renderChat(); $("#fbText").focus(); }
  };
  $("#fbBtn").addEventListener("click", () => open($("#fb").hidden));
  $("#fbClose").addEventListener("click", () => open(false));
  $("#fbText").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#fbForm").requestSubmit(); }
  });
  $("#fbForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("#fbText").value.trim();
    if (!text) return;
    const m = { me: true, text, t: Date.now() };
    chatLog.push(m); saveChat(); renderChat();
    $("#fbText").value = "";
    try {
      const r = await fetch(`https://ntfy.sh/${CHAT.in}`, {
        method: "POST", body: text,
        headers: { Title: `${CHAT.name} : retour sur le site`, Tags: "speech_balloon" },
      });
      if (!r.ok) throw new Error(r.status);
    } catch {
      m.fail = true; saveChat(); renderChat();
      toast("Message non envoyé : vérifiez votre connexion");
    }
  });

  // Replies from the team arrive live on the "out" topic.
  const seen = new Set(chatLog.map((m) => m.id).filter(Boolean));
  const since = Math.floor((chatLog.filter((m) => !m.me).map((m) => m.t).pop() || Date.now() - 864e5) / 1000);
  const es = new EventSource(`https://ntfy.sh/${CHAT.out}/sse?since=${since}`);
  es.onmessage = (ev) => {
    const d = JSON.parse(ev.data);
    if (d.event !== "message" || seen.has(d.id)) return;
    seen.add(d.id);
    chatLog.push({ me: false, text: d.message, t: d.time * 1000, id: d.id });
    saveChat(); renderChat();
    if ($("#fb").hidden) { $(".fb-dot").hidden = false; toast("Nouvelle réponse de l'équipe"); }
  };
}

boot();
