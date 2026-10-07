const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = (value) => new Intl.NumberFormat('fr-FR', {style:'currency',currency:'EUR'}).format(Number(value || 0));
const imageFallback = 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=900&q=80';
const REMEMBER_DAYS = 30;
const REMEMBER_MS = REMEMBER_DAYS * 24 * 60 * 60 * 1000;
function clearAuth() { localStorage.removeItem('userInfo'); sessionStorage.removeItem('userInfo'); }
function user() {
  try {
    const saved = JSON.parse(localStorage.getItem('userInfo') || 'null');
    if (saved?.rememberUntil && saved.rememberUntil <= Date.now()) { clearAuth(); return null; }
    if (saved) return saved;
    return JSON.parse(sessionStorage.getItem('userInfo') || 'null');
  } catch { clearAuth(); return null; }
}
function storeUser(account, rememberUntil = null) {
  clearAuth();
  const saved = {...account};
  if (rememberUntil && rememberUntil > Date.now()) {
    saved.rememberUntil = rememberUntil;
    localStorage.setItem('userInfo', JSON.stringify(saved));
  } else {
    delete saved.rememberUntil;
    sessionStorage.setItem('userInfo', JSON.stringify(saved));
  }
  return saved;
}
const token = () => user()?.token;
const cart = () => JSON.parse(localStorage.getItem('cartItems') || '[]');
let activeConversation = null;
let dashboardTab = 'products';
let adminTab = 'products';
let announcementsCache = [];
let refreshInProgress = null;

async function refreshAuth(force = false) {
  const current = user();
  if (!current?.refreshToken) return current;
  if (current.rememberUntil && current.rememberUntil <= Date.now()) {
    clearAuth();
    throw new Error('Ta session de 30 jours a expiré. Connecte-toi à nouveau.');
  }
  if (!force && (!current.tokenExpiresAt || current.tokenExpiresAt > Math.floor(Date.now()/1000) + 60)) return current;
  if (refreshInProgress) return refreshInProgress;
  refreshInProgress = (async () => {
    const response = await fetch('/api/auth/refresh', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken:current.refreshToken})});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { clearAuth(); throw new Error(data.detail || 'Session expirée. Connecte-toi à nouveau.'); }
    return storeUser({...current,...data}, current.rememberUntil || null);
  })();
  try { return await refreshInProgress; }
  finally { refreshInProgress = null; }
}

async function api(path, options = {}, retryAfterRefresh = true) {
  const shouldSkipRefresh = ['/auth/login','/auth/register','/auth/refresh','/auth/oauth/complete'].some(route => path.startsWith(route));
  if (!shouldSkipRefresh) await refreshAuth();
  const headers = new Headers(options.headers || {});
  if (token()) headers.set('Authorization', `Bearer ${token()}`);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, {...options, headers});
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const current = user();
    if (response.status === 401 && retryAfterRefresh && !shouldSkipRefresh && current?.refreshToken) {
      await refreshAuth(true);
      return api(path, options, false);
    }
    if (response.status === 401 && !shouldSkipRefresh) clearAuth();
    throw new Error(data.detail || data.message || 'Une erreur est survenue.');
  }
  return data;
}
function notify(message, error = false) {
  const root = $('#toast-root');
  root.innerHTML = `<div class="toast ${error?'error-toast':''}">${esc(message)}</div>`;
  window.setTimeout(() => root.replaceChildren(), 3200);
}
function go(path) { history.pushState({}, '', path); window.scrollTo(0,0); render(); }
function productId(product) { return product?._id || product?.id; }
function addToCart(product, quantity = 1) {
  const items = cart();
  const id = productId(product);
  const existing = items.find(item => (item._id || item.id) === id);
  if (existing) existing.quantity += quantity;
  else items.push({...product, quantity});
  localStorage.setItem('cartItems', JSON.stringify(items));
  header(); notify('Ajouté au panier');
}
function productCard(product) {
  return `<article class="product-card reveal"><a href="/produit/${encodeURIComponent(productId(product))}" data-link class="product-cover" style="background-image:url('${esc(product.image || imageFallback)}')"><span class="product-tag">${esc(product.isDigital?'DIGITAL':product.category || 'STUDIO')}</span></a><div class="product-info"><div class="product-category">${esc(product.category || 'Création')}</div><a href="/produit/${encodeURIComponent(productId(product))}" data-link><h3>${esc(product.name)}</h3></a><div class="product-meta"><span>${product.rating ? `★ ${Number(product.rating).toFixed(1)} · ${product.numReviews||0} avis` : esc(product.seller?.sellerInfo?.storeName || product.seller?.name || 'Édition indépendante')}</span><strong class="price">${money(product.price)}</strong></div></div></article>`;
}
function header() {
  const current = user();
  const links = [['/instrumentaux','Beats'],['/materiel','Équipement'],['/instruments','Instruments']];
  $('#site-header').innerHTML = `<div class="nav-inner"><a class="brand" href="/" data-link><span class="brand-mark">g.</span><span>GOSTMOOD<span style="color:var(--lime)">®</span></span></a><nav class="nav-links" id="nav-links">${links.map(([href,label])=>`<a href="${href}" data-link>${label}</a>`).join('')}<a href="/messages" data-link>Messages</a></nav><div class="nav-actions"><a class="cart-link" href="/panier" data-link>Panier <span class="cart-count">${cart().reduce((sum,item)=>sum+Number(item.quantity||1),0)}</span></a>${current?`<a class="account-link text-link" href="${current.role==='admin'?'/admin':current.role==='seller'?'/vendeur':'/profil'}" data-link>${esc(current.name||'Mon compte')}</a><button class="btn btn-ghost" data-action="logout">Quitter</button>`:`<a class="account-link btn btn-ghost" href="/connexion" data-link>Connexion</a>`}<button class="mobile-menu" data-action="menu" aria-label="Ouvrir le menu">☰</button></div></div>`;
  $('#site-footer').innerHTML = `<div class="footer-inner"><a class="brand" href="/" data-link><span class="brand-mark">g.</span><span>GOSTMOOD®</span></a><span>Un espace indépendant pour le son et la création.</span><button class="text-link" data-action="privacy">Politique de confidentialité</button><span>© ${new Date().getFullYear()} GostMood Creative Lab</span></div>`;
}
function animate() {
  if (!window.gsap) return;
  gsap.registerPlugin(ScrollTrigger);
  gsap.fromTo('.hero-content > *', {y:24}, {y:0,duration:.8,stagger:.1,ease:'power3.out',clearProps:'transform'});
  gsap.utils.toArray('.reveal').forEach(el => gsap.fromTo(el,{y:20,opacity:0},{y:0,opacity:1,duration:.55,ease:'power2.out',scrollTrigger:{trigger:el,start:'top 92%',once:true}}));
}
const page = (content, cls='page-wrap') => `<div class="${cls}">${content}</div>`;
const empty = (title, message, href='/instrumentaux', label='Explorer le catalogue') => `<div class="panel" style="text-align:center;padding:45px"><div class="eyebrow">${esc(title)}</div><p class="muted">${esc(message)}</p><a class="btn btn-primary" href="${href}" data-link>${label}</a></div>`;

async function homePage() {
  const health = await api('/health');
  const [featured, announcements] = health.databaseConfigured
    ? await Promise.all([api('/products/featured'), api('/announcements')])
    : [[], []];
  announcementsCache = announcements;
  const announcement = announcements[0];
  return `${health.databaseConfigured?'':`<div class="page-wrap" style="padding-bottom:0"><div class="announcement"><div><strong>Base de données non configurée</strong><p class="muted">Ajoutez vos clés Supabase dans apps/backend/.env, puis exécutez le script SQL indiqué dans le README.</p></div></div></div>`}<section class="hero"><div class="hero-image"></div><div class="hero-content"><div class="eyebrow">LE LABORATOIRE DE LA CRÉATION SONORE · PARIS</div><h1>FAIS DU<br/>BRUIT<span>.</span><br/>FAIS TA PLACE.</h1><p class="hero-copy">Le point de rencontre des beatmakers, musiciens et esprits libres. Trouve ton prochain son, ton prochain outil, ton prochain déclic.</p><div class="hero-actions"><a class="btn btn-primary" href="/instrumentaux" data-link>Explorer le catalogue <span>↗</span></a><a class="btn btn-ghost" href="/inscription" data-link>Rejoindre le lab</a></div><div class="mono" style="margin-top:60px;color:#88887d">INDÉPENDANT · CRÉATIF · SANS COMPROMIS</div></div></section><section class="section"><div class="section-head"><div><div class="section-kicker">Trouve ton terrain de jeu</div><h2 class="section-title">Tout commence par<br/>une bonne source.</h2></div></div><div class="category-grid"><a class="category-tile" href="/instrumentaux" data-link style="--tile-image:url('https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=900&q=80')"><span class="eyebrow">01 / PRODUCTION</span><h3>Instrumentaux</h3><p>Des prods qui n’attendent que ta voix.</p></a><a class="category-tile" href="/materiel" data-link style="--tile-image:url('https://images.unsplash.com/photo-1593078166033-9e9a9e1273c0?auto=format&fit=crop&w=900&q=80')"><span class="eyebrow">02 / STUDIO</span><h3>Matériel</h3><p>Les outils pour façonner ta signature.</p></a><a class="category-tile" href="/instruments" data-link style="--tile-image:url('https://images.unsplash.com/photo-1510915361894-db8b60106cb1?auto=format&fit=crop&w=900&q=80')"><span class="eyebrow">03 / INSTRUMENTS</span><h3>Instruments</h3><p>Fais vibrer les murs, et le reste.</p></a></div></section><section class="section" style="padding-top:20px"><div class="section-head"><div><div class="section-kicker">La sélection du moment</div><h2 class="section-title">À écouter. À jouer.<br/>À s’approprier.</h2></div><a class="text-link" href="/instrumentaux" data-link>Tout le catalogue ↗</a></div><div class="products-grid">${featured.length?featured.map(productCard).join(''):'<p class="empty-products">Les nouveautés arrivent bientôt.</p>'}</div></section>${announcement?`<section class="section" style="padding-top:5px"><div class="promo"><div><div class="eyebrow">${esc(announcement.badge || 'À LA UNE')}</div><h2>${esc(announcement.title)}</h2><p>${esc(announcement.subtitle || '')}</p></div><a class="btn" href="${esc(announcement.link || '/instrumentaux')}" data-link>${esc(announcement.cta || 'Découvrir')} ↗</a></div></section>`:''}<section class="section" style="padding-top:25px"><div class="promo"><div><div class="eyebrow">LE LAB EST OUVERT</div><h2>Ta création mérite mieux qu’un dossier oublié.</h2><p>Ouvre ta boutique, partage ton univers, trouve ton public.</p></div><a class="btn" href="/inscription?role=seller" data-link>Vendre sur GostMood ↗</a></div></section>`;
}
async function catalogPage(category, url) {
  const query = new URLSearchParams(url.search);
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  for (const key of ['search','sort','page','minPrice','maxPrice']) if (query.has(key)) params.set(key, query.get(key));
  let data;
  try { data = await api(`/products?${params}`); }
  catch { data = {products:[], page:1, pages:1, total:0}; }
  const titles = {instrumental:'Les instrumentaux',equipment:'Le matériel',instrument:'Les instruments'};
  return page(`<div class="eyebrow">CATALOGUE GOSTMOOD</div><h1 class="page-title">${titles[category] || 'Tous les produits'}<span style="color:var(--lime)">.</span></h1><div class="filter-bar"><input class="field" id="catalog-search" placeholder="Chercher un son, une marque…" value="${esc(query.get('search')||'')}"/><select class="select-field" id="catalog-sort"><option value="newest">Plus récents</option><option value="price_asc" ${query.get('sort')==='price_asc'?'selected':''}>Prix croissant</option><option value="price_desc" ${query.get('sort')==='price_desc'?'selected':''}>Prix décroissant</option><option value="rating" ${query.get('sort')==='rating'?'selected':''}>Mieux notés</option></select><span class="muted">${data.total} résultat(s)</span></div><div class="products-grid">${data.products.length?data.products.map(productCard).join(''):'<div class="empty-products">Aucun produit ne correspond à cette recherche.</div>'}</div><div class="inline-actions" style="justify-content:center;margin-top:28px">${data.page>1?`<button class="btn btn-ghost" data-action="page" data-page="${data.page-1}">← Précédent</button>`:''}${data.page<data.pages?`<button class="btn btn-ghost" data-action="page" data-page="${data.page+1}">Suivant →</button>`:''}</div>`);
}
async function detailPage(id) {
  const p = await api(`/products/${encodeURIComponent(id)}`);
  return page(`<div class="eyebrow"><a href="/instrumentaux" data-link>← RETOUR AU CATALOGUE</a></div><div class="detail-layout" style="margin-top:26px"><div><div class="detail-image" style="background-image:url('${esc(p.image||imageFallback)}')"></div>${p.audioPreview?`<audio class="audio-player" controls src="${esc(p.audioPreview)}"></audio>`:''}</div><div><div class="product-category">${esc(p.category)} ${p.subcategory?`/ ${esc(p.subcategory)}`:''}</div><h1 class="detail-title">${esc(p.name)}</h1><div class="detail-price">${money(p.price)}</div><p class="detail-description">${esc(p.description)}</p><div class="muted" style="font-size:12px;margin:15px 0">${p.rating?`<span class="rating">★ ${Number(p.rating).toFixed(1)}</span> · ${p.numReviews||0} avis · `:''}Par ${esc(p.seller?.sellerInfo?.storeName||p.seller?.name||'Créateur GostMood')} · ${p.isDigital?'Produit numérique':`Stock : ${p.stock}`}</div>${p.license?`<span class="badge">Licence ${esc(p.license)}</span>`:''}<div class="inline-actions" style="margin-top:25px"><button class="btn btn-primary" data-action="add-product" data-id="${esc(p._id)}">Ajouter au panier ↗</button>${p.seller?`<button class="btn btn-ghost" data-action="contact-seller" data-seller="${esc(p.seller._id)}" data-product="${esc(p._id)}">Contacter le vendeur</button>`:''}</div><div class="review-form"><h3 class="section-kicker">Avis de la communauté</h3>${(p.reviews||[]).map(r=>`<div class="announcement"><div><strong>${esc(r.user?.name||'Membre')}</strong> <span class="rating">${'★'.repeat(r.rating)}</span><p class="muted">${esc(r.comment||'')}</p></div></div>`).join('')||'<p class="muted">Pas encore d’avis. À toi d’ouvrir le bal.</p>'}${user()?`<form id="review-form"><label class="form-label">Ta note</label><select class="select-field" name="rating"><option value="5">5 étoiles</option><option value="4">4 étoiles</option><option value="3">3 étoiles</option><option value="2">2 étoiles</option><option value="1">1 étoile</option></select><textarea class="form-field" name="comment" placeholder="Partage ton expérience…"></textarea><button class="btn btn-ghost">Publier mon avis</button></form>`:''}</div></div></div>`);
}
function cartPage() {
  const items = cart();
  if (!items.length) return page(`<div class="eyebrow">PANIER</div><h1 class="page-title">L’espace avant le prochain son.</h1>${empty('Rien pour le moment','Ton panier est vide. Le prochain coup de cœur est peut-être juste ici.')}`);
  const subtotal = items.reduce((sum,item)=>sum+Number(item.price)*Number(item.quantity),0);
  const shipping = items.some(item=>!item.isDigital)&&subtotal<50?5.99:0;
  return page(`<div class="eyebrow">TON SÉLECTIONNÉ</div><h1 class="page-title">Le panier<span style="color:var(--lime)">.</span></h1><div>${items.map(item=>`<div class="cart-row"><img class="cart-thumb" src="${esc(item.image||imageFallback)}" alt=""/><div><a href="/produit/${esc(item._id||item.id)}" data-link><strong>${esc(item.name)}</strong></a><div class="muted" style="font-size:11px">${item.isDigital?'Produit numérique':'Expédition physique'}</div><button class="text-link remove-item" data-action="remove-cart" data-id="${esc(item._id||item.id)}">Retirer</button></div><div class="qty"><button data-action="quantity" data-id="${esc(item._id||item.id)}" data-delta="-1">−</button><span>${item.quantity}</span><button data-action="quantity" data-id="${esc(item._id||item.id)}" data-delta="1">+</button></div><strong class="price line-price">${money(item.price*item.quantity)}</strong></div>`).join('')}</div><div class="cart-summary"><div class="summary-line"><span>Sous-total</span><strong>${money(subtotal)}</strong></div><div class="summary-line"><span>Livraison</span><strong>${shipping?money(shipping):'Offerte'}</strong></div><div class="summary-line total"><span>Total estimé</span><strong>${money(subtotal+shipping)}</strong></div><a class="btn btn-primary" style="width:100%;margin-top:15px" href="/paiement" data-link>Passer à la caisse ↗</a></div>`);
}
function authPage(register) {
  const role = new URLSearchParams(location.search).get('role')==='seller'?'seller':'buyer';
  const passwordField = `<label class="form-label">Mot de passe</label><div class="password-field"><input class="form-field" name="password" type="password" minlength="8" required autocomplete="${register?'new-password':'current-password'}"/><button type="button" class="password-toggle" data-action="toggle-password" aria-label="Afficher le mot de passe" aria-pressed="false">◉</button></div>`;
  if (!register) return page(`<form class="form-card" id="auth-form"><div class="eyebrow">CONTENT DE TE REVOIR</div><h1>Connecte-toi.</h1><label class="form-label">Adresse email</label><input class="form-field" name="email" type="email" required autocomplete="email"/>${passwordField}<label class="privacy-consent"><input type="checkbox" name="privacyConsent" required/><span>J’ai lu et j’accepte la <button type="button" class="text-link privacy-open" data-action="privacy">Politique de confidentialité</button>.</span></label><label class="remember-consent"><input type="checkbox" id="remember-me" name="rememberMe"/><span>Se souvenir de moi pendant 30 jours sur cet appareil</span></label><p class="form-error" id="auth-error"></p><button class="btn btn-primary" style="width:100%;margin:8px 0 18px">Connexion ↗</button><div class="auth-divider"><span>OU CONTINUER AVEC</span></div><button type="button" class="btn btn-ghost google-button" data-action="google-auth" data-flow="login"><span class="google-g">G</span> Continuer avec Google</button><p class="muted" style="font-size:12px">Pas encore de compte ? <a class="text-link" href="/inscription" data-link>Inscris-toi</a></p></form>`);
  return page(`<form class="form-card signup-card" id="auth-form" data-step="1"><div class="eyebrow">REJOINS LE LAB</div><h1>Crée ton espace.</h1><div class="signup-steps" aria-label="Étapes de l’inscription"><span class="signup-step active" data-step-indicator="1"><b>1</b> Identité</span><span class="signup-step" data-step-indicator="2"><b>2</b> Profil</span><span class="signup-step" data-step-indicator="3"><b>3</b> Mot de passe</span></div><p class="signup-progress" id="signup-progress">Étape 1 sur 3 · Identité</p><section class="signup-panel" data-step-panel="1"><label class="form-label" for="signup-name">Nom complet</label><input class="form-field" id="signup-name" name="name" autocomplete="name" required/><label class="form-label" for="signup-email">Adresse email</label><input class="form-field" id="signup-email" name="email" type="email" autocomplete="email" required/></section><section class="signup-panel" data-step-panel="2" hidden><label class="form-label" for="signup-role">Je souhaite rejoindre GostMood comme</label><select class="form-field" id="signup-role" name="role"><option value="buyer" ${role==='buyer'?'selected':''}>Acheteur / musicien</option><option value="seller" ${role==='seller'?'selected':''}>Vendeur / créateur</option></select><div id="store-name-wrap" hidden><label class="form-label" for="signup-store">Nom de ma boutique</label><input class="form-field" id="signup-store" name="storeName" autocomplete="organization" disabled/></div><p class="muted">Tu pourras compléter ton profil et ta boutique après l’inscription.</p></section><section class="signup-panel" data-step-panel="3" hidden>${passwordField}<label class="privacy-consent"><input type="checkbox" name="privacyConsent" required disabled/><span>J’ai lu et j’accepte la <button type="button" class="text-link privacy-open" data-action="privacy">Politique de confidentialité</button>. Cette acceptation est obligatoire pour tout compte.</span></label><button type="button" class="btn btn-ghost google-button" data-action="google-auth" data-flow="signup"><span class="google-g">G</span> Continuer avec Google</button></section><p class="form-error" id="auth-error"></p><div class="signup-controls"><button type="button" class="btn btn-ghost" id="signup-back" data-action="signup-back" hidden>Précédent</button><button type="button" class="btn btn-primary" id="signup-next" data-action="signup-next">Suivant</button><button type="submit" class="btn btn-primary" id="signup-submit" hidden>Créer mon compte ↗</button></div><p class="muted signup-login-link">Déjà validée ? <a class="text-link" href="/connexion" data-link>Se connecter</a></p></form>`);
}
function setSignupStep(step) {
  const form = $('#auth-form');
  if (!form || location.pathname !== '/inscription') return;
  const activeStep = Math.max(1, Math.min(3, step));
  form.dataset.step = String(activeStep);
  const isSeller = $('#signup-role', form).value === 'seller';
  $('#store-name-wrap', form).hidden = !isSeller;
  $('#signup-store', form).disabled = !isSeller;
  $('[name="privacyConsent"]', form).disabled = false;
  $$('[data-step-panel]', form).forEach(panel => {
    const active = Number(panel.dataset.stepPanel) === activeStep;
    panel.hidden = !active;
  });
  $$('[data-step-indicator]', form).forEach(item => {
    item.classList.toggle('active', Number(item.dataset.stepIndicator) === activeStep);
    item.classList.toggle('complete', Number(item.dataset.stepIndicator) < activeStep);
  });
  $('#signup-progress').textContent = `Étape ${activeStep} sur 3 · ${['Identité','Profil','Mot de passe'][activeStep-1]}`;
  $('#signup-back').hidden = activeStep === 1;
  $('#signup-next').hidden = activeStep === 3;
  $('#signup-submit').hidden = activeStep !== 3;
  $('#auth-error').textContent = '';
}
function validateSignupStep() {
  const form = $('#auth-form');
  const step = Number(form?.dataset.step || 1);
  const panel = $(`[data-step-panel="${step}"]`, form);
  const invalid = $$('input,select,textarea', panel).find(control => !control.disabled && control.required && !control.checkValidity());
  if (invalid) { invalid.reportValidity(); return false; }
  return true;
}
function renderCookieConsent() {
  if (document.cookie.split(';').some(value => value.trim().startsWith('gm_cookie_consent='))) return;
  if ($('#cookie-consent')) return;
  const banner = document.createElement('aside');
  banner.id = 'cookie-consent';
  banner.className = 'cookie-banner';
  banner.setAttribute('aria-label', 'Choix des cookies');
  banner.innerHTML = `<div class="cookie-copy"><strong>Votre confidentialité compte.</strong><p>Nous utilisons uniquement le stockage nécessaire au fonctionnement du site. Aucun cookie publicitaire ou outil d’analyse n’est actif.</p><button class="text-link" data-action="cookie-preferences">Détails et préférences</button></div><div class="cookie-actions"><button class="btn btn-ghost" data-action="cookie-reject">Refuser l’optionnel</button><button class="btn btn-primary" data-action="cookie-accept">Accepter</button></div>`;
  document.body.append(banner);
}
function saveCookieConsent(optional = false) {
  const choice = `essential:1,optional:${optional ? 1 : 0},date:${new Date().toISOString()}`;
  document.cookie = `gm_cookie_consent=${encodeURIComponent(choice)}; Max-Age=15552000; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  $('#cookie-consent')?.remove();
  $('.cookie-dialog')?.close();
}
function showCookiePreferences() {
  if ($('.cookie-dialog')) return;
  const savedChoice = decodeURIComponent(document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith('gm_cookie_consent='))?.split('=').slice(1).join('=') || '');
  const optionalChecked = savedChoice.includes('optional:1');
  const dialog = document.createElement('dialog');
  dialog.className = 'privacy-dialog cookie-dialog';
  dialog.innerHTML = `<div class="privacy-dialog-head"><div><div class="eyebrow">VOS CHOIX</div><h2>Préférences cookies</h2></div><button type="button" class="btn btn-ghost" data-action="close-cookie-preferences" aria-label="Fermer">×</button></div><div class="privacy-dialog-body"><p>Les cookies essentiels mémorisent votre choix de consentement et permettent les fonctions de base. Ils sont toujours actifs. Aucun cookie analytique, publicitaire ou de mesure d’audience n’est actuellement installé par GostMood.</p><label class="privacy-consent"><input type="checkbox" checked disabled/><span>Cookies essentiels — toujours actifs</span></label><label class="privacy-consent"><input type="checkbox" name="optionalCookies" ${optionalChecked?'checked':''}/><span>Cookies optionnels — aucun service optionnel n’est activé actuellement.</span></label></div><div class="privacy-dialog-actions"><button type="button" class="btn btn-primary" data-action="save-cookie-preferences">Enregistrer mon choix</button><button type="button" class="btn btn-ghost" data-action="close-cookie-preferences">Fermer</button></div>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), {once:true});
  dialog.showModal();
}
async function startGoogleAuth(flow) {
  if (flow === 'signup') {
    if (Number($('#auth-form')?.dataset.step) !== 3 || !$('[name="privacyConsent"]')?.checked) {
      $('#auth-error').textContent = 'Termine les étapes et accepte la Politique de confidentialité avant de continuer avec Google.';
      return;
    }
    sessionStorage.setItem('gm_google_signup', JSON.stringify({flow:'signup',name:$('#signup-name').value.trim(),email:$('#signup-email').value.trim(),role:$('#signup-role').value,storeName:$('#signup-store').value,privacyAccepted:true,privacyPolicyVersion:'2026-10-07'}));
  } else {
    if (!$('[name="privacyConsent"]')?.checked) {
      $('#auth-error').textContent = 'Tu dois accepter la Politique de confidentialité pour te connecter.';
      return;
    }
    sessionStorage.setItem('gm_google_signup', JSON.stringify({flow:'login',privacyAccepted:true,privacyPolicyVersion:'2026-10-07',rememberMe:$('#remember-me')?.checked===true}));
  }
  clearAuth();
  location.href = `/api/auth/google?flow=${encodeURIComponent(flow)}`;
}
async function finishGoogleAuth() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  const accessToken = fragment.get('access_token');
  const refreshToken = fragment.get('refresh_token');
  const error = fragment.get('error_description') || fragment.get('error') || query.get('error_description') || query.get('error');
  history.replaceState({}, '', '/auth/callback');
  if (!accessToken) { sessionStorage.removeItem('gm_google_signup'); return page(`<div class="form-card"><div class="eyebrow">CONNEXION GOOGLE</div><h1>Connexion interrompue.</h1><p class="muted">${esc(error || 'Google n’a pas retourné de session. Réessaie ou vérifie la configuration OAuth Supabase.')}</p><a class="btn btn-primary" href="/connexion" data-link>Retour à la connexion</a></div>`); }
  try {
    const intent = JSON.parse(sessionStorage.getItem('gm_google_signup') || '{"flow":"login"}');
    sessionStorage.removeItem('gm_google_signup');
    let profile;
    if (intent.privacyAccepted) {
      profile = await api('/auth/profile', {headers:{Authorization:`Bearer ${accessToken}`}});
      if (intent.flow === 'signup' && intent.email && profile.email?.toLowerCase() !== intent.email.toLowerCase()) {
        throw new Error('L’adresse Google doit correspondre à l’adresse saisie à l’étape Identité. Recommence avec la même adresse.');
      }
      profile = await api('/auth/oauth/complete', {method:'POST',headers:{Authorization:`Bearer ${accessToken}`},body:JSON.stringify(intent)});
    } else {
      throw new Error('Le consentement à la Politique de confidentialité est requis. Recommence depuis le formulaire de connexion.');
    }
    const signedIn = {...profile,token:accessToken,refreshToken,tokenExpiresAt:Math.floor(Date.now()/1000)+Number(fragment.get('expires_in')||3600)};
    storeUser(signedIn, intent.rememberMe ? Date.now()+REMEMBER_MS : null);
    const destination = signedIn.role === 'admin' ? '/admin' : signedIn.role === 'seller' ? '/vendeur' : '/';
    history.replaceState({}, '', destination);
    return null;
  } catch (error) {
    sessionStorage.removeItem('gm_google_signup');
    return page(`<div class="form-card"><div class="eyebrow">CONNEXION GOOGLE</div><h1>Finalisation impossible.</h1><p class="muted">${esc(error.message)}</p><a class="btn btn-primary" href="/inscription" data-link>Créer un compte</a></div>`);
  }
}
function checkoutPage() {
  if (!user()) return `<div class="form-card"><h2>Connexion requise</h2><p class="muted">Connecte-toi pour finaliser ta commande.</p><a class="btn btn-primary" href="/connexion?redirect=/paiement" data-link>Connexion</a></div>`;
  const items=cart();if(!items.length)return empty('PANIER VIDE','Ajoute un produit avant de passer à la caisse.','/instrumentaux');
  const total=items.reduce((sum,item)=>sum+Number(item.price)*item.quantity,0);const shipping=items.some(item=>!item.isDigital)&&total<50?5.99:0;
  return page(`<div class="eyebrow">DERNIÈRE ÉTAPE</div><h1 class="page-title">On finalise<span style="color:var(--lime)">.</span></h1><form class="form-card" style="max-width:760px;margin:0" id="checkout-form"><div class="form-grid">${['name','address','city','postalCode','country'].map((key,i)=>`<div><label class="form-label">${['Nom complet','Adresse','Ville','Code postal','Pays'][i]}</label><input class="form-field" name="${key}" ${key==='country'?'value="France"':''} ${i<4?'required':''}/></div>`).join('')}</div><label class="form-label">Moyen de paiement</label><select class="form-field" name="paymentMethod"><option value="simulation">Paiement de démonstration (aucun débit)</option></select><p class="muted" style="font-size:11px">Paiement simulé : aucun paiement réel n’est effectué sur cette version.</p><div class="summary-line"><span>Articles · ${items.length}</span><strong>${money(total)}</strong></div><div class="summary-line"><span>Livraison</span><strong>${shipping?money(shipping):'Offerte'}</strong></div><div class="summary-line total"><span>Total</span><strong>${money(total+shipping)}</strong></div><p class="form-error" id="checkout-error"></p><button class="btn btn-primary" style="width:100%">Confirmer la commande ↗</button></form>`);
}
async function ordersPage() {
  const orders=await api('/orders/myorders');return page(`<div class="eyebrow">TON PARCOURS</div><h1 class="page-title">Mes commandes<span style="color:var(--lime)">.</span></h1>${orders.length?`<div class="table-wrap"><table><thead><tr><th>Commande</th><th>Date</th><th>Articles</th><th>Total</th><th>Statut</th><th></th></tr></thead><tbody>${orders.map(o=>`<tr><td>${esc(o._id.slice(0,8))}</td><td>${new Date(o.createdAt).toLocaleDateString('fr-FR')}</td><td>${o.items?.length||0}</td><td>${money(o.totalPrice)}</td><td><span class="badge">${esc(o.status)}</span></td><td>${['pending','processing'].includes(o.status)?`<button class="text-link" data-action="cancel-order" data-id="${esc(o._id)}">Annuler</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:empty('AUCUNE COMMANDE','Tes prochaines trouvailles seront gardées ici.')}`);
}
async function productFormPage(id='') {
  let p={};if(id)p=await api(`/products/${encodeURIComponent(id)}`).catch(()=>({}));
  return page(`<div class="eyebrow"><a href="/vendeur" data-link>← ESPACE VENDEUR</a></div><form class="form-card" style="max-width:850px;margin:24px 0" id="product-form" data-id="${esc(id)}"><h1>${id?'Modifier':'Ajouter'} un produit</h1><div class="form-grid">${[['name','Nom du produit'],['price','Prix (€)'],['brand','Marque / producteur'],['stock','Stock']].map(([key,label])=>`<div><label class="form-label">${label}</label><input class="form-field" name="${key}" value="${esc(p[key]??'')}" ${key==='price'?'type="number" min="0" step="0.01"':''} ${key==='stock'?'type="number" min="0"':''} required/></div>`).join('')}<div><label class="form-label">Catégorie</label><select class="form-field" name="category"><option value="instrumental" ${p.category==='instrumental'?'selected':''}>Instrumental</option><option value="equipment" ${p.category==='equipment'?'selected':''}>Matériel</option><option value="instrument" ${p.category==='instrument'?'selected':''}>Instrument</option></select></div><div><label class="form-label">Licence</label><select class="form-field" name="license"><option>Basique</option><option ${p.license==='Premium'?'selected':''}>Premium</option><option ${p.license==='Exclusif'?'selected':''}>Exclusif</option></select></div></div><label class="form-label">Description</label><textarea class="form-field" name="description" required>${esc(p.description||'')}</textarea><label class="form-label">Image (URL)</label><input class="form-field" name="image" value="${esc(p.image||'')}"/><label class="form-label">Aperçu audio (URL)</label><input class="form-field" name="audioPreview" value="${esc(p.audioPreview||'')}"/><label class="form-label"><input type="checkbox" name="isDigital" ${p.isDigital?'checked':''}/> Produit numérique</label><p class="muted" style="font-size:11px">Les nouveaux produits sont soumis à validation avant publication.</p><p id="product-error" class="form-error"></p><button class="btn btn-primary">Enregistrer le produit ↗</button></form>`);
}
async function sellerPage() {
  const [products,orders,announcements]=await Promise.all([api('/products/seller/myproducts'),api('/orders/seller'),api('/announcements/my')]);
  const sales=orders.reduce((n,o)=>n+Number(o.totalPrice||0),0);
  const tabs=['products','orders','announcements'];
  let content='';
  if(dashboardTab==='products')content=`<div class="inline-actions" style="justify-content:flex-end;margin:12px 0"><a class="btn btn-primary" href="/vendeur/ajouter" data-link>+ Nouveau produit</a></div>${products.length?`<div class="table-wrap"><table><thead><tr><th>Produit</th><th>Catégorie</th><th>Prix</th><th>Stock</th><th>Validation</th><th>Actions</th></tr></thead><tbody>${products.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.category)}</td><td>${money(p.price)}</td><td>${p.isDigital?'∞':p.stock}</td><td><span class="badge">${p.isApproved?'Publié':'En attente'}</span></td><td><a class="text-link" href="/vendeur/modifier/${esc(p._id)}" data-link>Modifier</a> <button class="text-link" data-action="delete-product" data-id="${esc(p._id)}">Supprimer</button></td></tr>`).join('')}</tbody></table></div>`:empty('PAS ENCORE DE PRODUIT','Ajoute ton premier produit pour ouvrir ta boutique.','/vendeur/ajouter','Ajouter un produit')}`;
  if(dashboardTab==='orders')content=orders.length?`<div class="table-wrap"><table><thead><tr><th>Commande</th><th>Acheteur</th><th>Montant</th><th>Statut</th></tr></thead><tbody>${orders.map(o=>`<tr><td>${esc(o._id.slice(0,8))}</td><td>${esc(o.buyer?.name||'Membre')}</td><td>${money(o.totalPrice)}</td><td><span class="badge">${esc(o.status)}</span></td></tr>`).join('')}</tbody></table></div>`:empty('PAS DE COMMANDE','Les commandes de tes créations apparaîtront ici.');
  if(dashboardTab==='announcements')content=`<div class="inline-actions" style="justify-content:flex-end;margin:12px 0"><button class="btn btn-primary" data-action="new-announcement">+ Créer une annonce</button></div>${announcements.map(a=>`<div class="announcement">${a.image?`<img src="${esc(a.image)}" alt=""/>`:''}<div style="flex:1"><strong>${esc(a.title)}</strong><p class="muted">${a.approved?'Publiée':'En attente d’approbation'}</p></div><button class="text-link" data-action="delete-announcement" data-id="${esc(a._id)}">Supprimer</button></div>`).join('')||'<p class="muted">Aucune annonce pour le moment.</p>'}`;
  return page(`<div class="eyebrow">ESPACE CRÉATEUR</div><h1 class="page-title">${esc(user()?.sellerInfo?.storeName||user()?.name||'Ma boutique')}<span style="color:var(--lime)">.</span></h1><div class="stats-grid"><div class="stat-box"><span>PRODUITS</span><strong>${products.length}</strong></div><div class="stat-box"><span>COMMANDES</span><strong>${orders.length}</strong></div><div class="stat-box"><span>CHIFFRE BRUT</span><strong>${money(sales)}</strong></div><div class="stat-box"><span>STATUT VENDEUR</span><strong>${user()?.sellerInfo?.isApproved?'Actif':'À vérifier'}</strong></div></div><div class="dashboard-tabs">${tabs.map(t=>`<button class="tab-button ${dashboardTab===t?'active':''}" data-action="seller-tab" data-tab="${t}">${({products:'Produits',orders:'Commandes',announcements:'Annonces'})[t]}</button>`).join('')}</div>${content}`);
}
async function adminPage() {
  const [users,products,orders,announcements]=await Promise.all([api('/users'),api('/products/admin/all'),api('/orders/admin/all'),api('/announcements/admin/all')]);
  const names={users:'Utilisateurs',products:'Produits',orders:'Commandes',announcements:'Annonces'};
  let content='';
  if(adminTab==='users')content=`<div class="table-wrap"><table><thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Inscrit</th><th>Action</th></tr></thead><tbody>${users.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${new Date(u.createdAt).toLocaleDateString('fr-FR')}</td><td><button class="text-link" data-action="delete-user" data-id="${esc(u._id)}">Supprimer</button></td></tr>`).join('')}</tbody></table></div>`;
  if(adminTab==='products')content=`<div class="table-wrap"><table><thead><tr><th>Produit</th><th>Créateur</th><th>Prix</th><th>Visibilité</th><th>Action</th></tr></thead><tbody>${products.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.seller?.name||'')}</td><td>${money(p.price)}</td><td>${p.isApproved?'Publié':'Masqué'}</td><td><button class="text-link" data-action="approve-product" data-id="${esc(p._id)}">${p.isApproved?'Masquer':'Publier'}</button></td></tr>`).join('')}</tbody></table></div>`;
  if(adminTab==='orders')content=`<div class="table-wrap"><table><thead><tr><th>Référence</th><th>Acheteur</th><th>Total</th><th>Statut</th><th>Mise à jour</th></tr></thead><tbody>${orders.map(o=>`<tr><td>${esc(o._id.slice(0,8))}</td><td>${esc(o.buyer?.name||'')}</td><td>${money(o.totalPrice)}</td><td>${esc(o.status)}</td><td><select class="select-field" data-order-status="${esc(o._id)}">${['pending','processing','shipped','delivered','cancelled'].map(s=>`<option ${s===o.status?'selected':''}>${s}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>`;
  if(adminTab==='announcements')content=announcements.map(a=>`<div class="announcement"><div style="flex:1"><strong>${esc(a.title)}</strong><p class="muted">Par ${esc(a.seller?.name||'')} · ${a.approved?'Publiée':'En attente'}</p></div><button class="text-link" data-action="toggle-announcement" data-id="${esc(a._id)}" data-approved="${a.approved}">${a.approved?'Dépublier':'Approuver'}</button><button class="text-link" data-action="admin-delete-announcement" data-id="${esc(a._id)}">Supprimer</button></div>`).join('')||'<p class="muted">Aucune annonce soumise.</p>';
  return page(`<div class="eyebrow">GOSTMOOD / ADMIN</div><h1 class="page-title">Console admin<span style="color:var(--lime)">.</span></h1><div class="stats-grid"><div class="stat-box"><span>MEMBRES</span><strong>${users.length}</strong></div><div class="stat-box"><span>PRODUITS</span><strong>${products.length}</strong></div><div class="stat-box"><span>COMMANDES</span><strong>${orders.length}</strong></div><div class="stat-box"><span>VENTES PAYÉES</span><strong>${money(orders.filter(o=>o.isPaid).reduce((n,o)=>n+Number(o.totalPrice),0))}</strong></div></div><div class="dashboard-tabs">${Object.entries(names).map(([key,label])=>`<button class="tab-button ${adminTab===key?'active':''}" data-action="admin-tab" data-tab="${key}">${label}</button>`).join('')}</div>${content}`);
}
async function profilePage() {
  const me=await api('/auth/profile');return page(`<div class="eyebrow">TON COMPTE</div><h1 class="page-title">Profil<span style="color:var(--lime)">.</span></h1><form id="profile-form" class="form-card" style="margin:0"><label class="form-label">Nom</label><input class="form-field" name="name" value="${esc(me.name)}" required/><label class="form-label">Adresse email</label><input class="form-field" value="${esc(me.email)}" disabled/><label class="form-label">Nouveau mot de passe (facultatif)</label><input class="form-field" name="password" type="password" minlength="8"/><p id="profile-error" class="form-error"></p><button class="btn btn-primary">Enregistrer ↗</button></form><div style="margin-top:24px"><a class="btn btn-ghost" href="/commandes" data-link>Voir mes commandes</a></div>`);
}
async function messagesPage(url) {
  const [conversations,sellers]=await Promise.all([api('/messages'),api('/messages/sellers')]);
  const params=new URLSearchParams(url.search);activeConversation=params.get('id')||activeConversation;
  if(activeConversation&&!conversations.some(c=>c._id===activeConversation))activeConversation=null;
  const selected=conversations.find(c=>c._id===activeConversation);
  let messages=[];if(selected)messages=await api(`/messages/${selected._id}`);
  return page(`<div class="eyebrow">DIRECT LINE</div><h1 class="page-title">Messages<span style="color:var(--lime)">.</span></h1>${!selected?`<label class="form-label">Démarrer une conversation</label><select class="select-field" id="seller-pick"><option value="">Choisir un créateur…</option>${sellers.map(s=>`<option value="${esc(s._id)}">${esc(s.sellerInfo?.storeName||s.name)}</option>`).join('')}</select> <button class="btn btn-ghost" data-action="start-chat">Écrire ↗</button>`:''}<div class="message-layout" style="margin-top:15px"><div class="conversation-list">${conversations.map(c=>{const other=c.participants?.find(p=>p._id!==user()?._id);return `<a class="conversation-item ${c._id===activeConversation?'active':''}" href="/messages?id=${esc(c._id)}" data-link><strong>${esc(other?.sellerInfo?.storeName||other?.name||'Conversation')}</strong><p class="muted">${esc(c.lastMessage||'Démarrer la conversation')}</p></a>`}).join('')||'<p class="muted" style="padding:15px">Aucune conversation pour le moment.</p>'}</div><div class="chat-area">${selected?`<div class="eyebrow">AVEC ${esc(selected.participants?.find(p=>p._id!==user()?._id)?.name||'UN CRÉATEUR')}</div><div class="chat-messages">${messages.map(m=>`<div class="chat-message ${m.senderId===user()?._id?'mine':''}">${esc(m.content)}</div>`).join('')||'<p class="muted">Lance la conversation.</p>'}</div><form class="chat-form" id="message-form" data-id="${esc(selected._id)}"><input class="field" name="content" placeholder="Ton message…" required/><button class="btn btn-primary">Envoyer ↗</button></form>`:'<div class="muted" style="margin:auto">Choisis une conversation pour écrire.</div>'}</div></div>`);
}

async function render() {
  header();renderCookieConsent();const appRoot=$('#app');appRoot.innerHTML='<div class="loading">ON PRÉPARE LE LAB…</div>';
  const url=new URL(location.href), path=url.pathname;
  try {
    let html;
    if(path==='/auth/callback'){
      html=await finishGoogleAuth();
      if(html===null){render();return;}
    }
    else if(path==='/')html=await homePage();
    else if(['/instrumentaux','/materiel','/instruments'].includes(path))html=await catalogPage(({ '/instrumentaux':'instrumental','/materiel':'equipment','/instruments':'instrument'})[path],url);
    else if(path.startsWith('/produit/'))html=await detailPage(decodeURIComponent(path.split('/')[2]));
    else if(path==='/panier')html=cartPage();
    else if(path==='/connexion')html=authPage(false);
    else if(path==='/inscription')html=authPage(true);
    else if(path==='/paiement')html=checkoutPage();
    else if(path==='/commandes')html=await ordersPage();
    else if(path==='/profil')html=user()?await profilePage():authPage(false);
    else if(path==='/vendeur')html=user()?.role==='seller'||user()?.role==='admin'?await sellerPage():authPage(false);
    else if(path==='/vendeur/ajouter')html=user()?.role==='seller'||user()?.role==='admin'?await productFormPage():authPage(false);
    else if(path.startsWith('/vendeur/modifier/'))html=user()?.role==='seller'||user()?.role==='admin'?await productFormPage(decodeURIComponent(path.split('/')[3])):authPage(false);
    else if(path==='/admin')html=user()?.role==='admin'?await adminPage():authPage(false);
    else if(path==='/messages')html=user()?await messagesPage(url):authPage(false);
    else html=page(`<div class="eyebrow">ERREUR 404</div><h1 class="page-title">Cette page n’existe pas.</h1><a class="btn btn-primary" href="/" data-link>Retour à l’accueil</a>`);
    appRoot.innerHTML=html;
    if(path==='/inscription')setSignupStep(1);
    animate();
  } catch(error) { appRoot.innerHTML=page(`<div class="eyebrow">OUPS</div><h1 class="page-title">Impossible de charger cette page.</h1><p class="muted">${esc(error.message)}</p><button class="btn btn-ghost" data-action="retry">Réessayer</button>`); }
}

function serialize(form) { return Object.fromEntries(new FormData(form).entries()); }
function showPrivacyPolicy() {
  const dialog = document.createElement('dialog');
  dialog.className = 'privacy-dialog';
  dialog.innerHTML = `<div class="privacy-dialog-head"><div><div class="eyebrow">INFORMATIONS LÉGALES</div><h2>Politique de confidentialité</h2></div><button type="button" class="btn btn-ghost" data-action="close-privacy" aria-label="Fermer">×</button></div><div class="privacy-dialog-body"><p><strong>Responsable du traitement :</strong> GostMood Creative Lab. Pour toute question concernant vos données, contactez l’équipe via le site.</p><h3>Données collectées</h3><p>Lors de l’inscription, nous collectons votre nom, votre adresse email, votre mot de passe (géré de manière sécurisée par Supabase Auth) et votre type de compte. Les informations de boutique sont utilisées si vous choisissez le profil vendeur.</p><h3>Utilisation</h3><p>Ces données servent à créer et sécuriser votre compte, fournir les fonctions acheteur ou vendeur, gérer les commandes et répondre aux demandes d’assistance. Elles ne sont pas vendues.</p><h3>Prestataires et conservation</h3><p>L’authentification et le stockage des données sont fournis par Supabase. Les données sont conservées tant que votre compte est actif ou lorsque la loi impose leur conservation. Vous pouvez demander l’accès, la rectification ou la suppression de vos données en contactant l’équipe.</p><h3>Votre choix</h3><p>L’acceptation de cette politique est requise pour créer un compte ou se connecter. Fermez cette fenêtre pour revenir au formulaire et cocher la case de consentement.</p><p class="muted">Politique initiale du projet — à compléter avec les coordonnées légales et les durées de conservation définitives avant toute mise en production.</p></div><div class="privacy-dialog-actions"><button type="button" class="btn btn-ghost" data-action="close-privacy">Fermer</button></div>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), {once:true});
  dialog.showModal();
}
document.addEventListener('click', async event => {
  const link=event.target.closest('a[data-link]');
  if(link){const url=new URL(link.href,location.href);if(url.origin===location.origin){event.preventDefault();go(url.pathname+url.search);return;}}
  const button=event.target.closest('[data-action]');if(!button)return;
  const action=button.dataset.action;
  try {
    if(action==='menu')$('#nav-links').classList.toggle('open');
    if(action==='signup-next'){const step=Number($('#auth-form')?.dataset.step||1);if(validateSignupStep())setSignupStep(step+1);return;}
    if(action==='signup-back'){setSignupStep(Number($('#auth-form')?.dataset.step||1)-1);return;}
    if(action==='toggle-password'){const input=button.parentElement.querySelector('input');if(input){const visible=input.type==='password';input.type=visible?'text':'password';button.setAttribute('aria-pressed',String(visible));button.setAttribute('aria-label',visible?'Masquer le mot de passe':'Afficher le mot de passe');button.textContent=visible?'⊘':'◉';}return;}
    if(action==='google-auth'){await startGoogleAuth(button.dataset.flow);return;}
    if(action==='cookie-accept'){saveCookieConsent(true);return;}
    if(action==='cookie-reject'){saveCookieConsent(false);return;}
    if(action==='cookie-preferences'){showCookiePreferences();return;}
    if(action==='close-cookie-preferences'){$('.cookie-dialog')?.close();return;}
    if(action==='save-cookie-preferences'){saveCookieConsent($('[name="optionalCookies"]')?.checked===true);return;}
    if(action==='privacy'){showPrivacyPolicy();return;}
    if(action==='close-privacy'){$('.privacy-dialog')?.close();return;}
    if(action==='logout'){clearAuth();go('/');}
    if(action==='retry')render();
    if(action==='add-product'){const p=await api(`/products/${encodeURIComponent(button.dataset.id)}`);addToCart(p);}
    if(action==='remove-cart'){localStorage.setItem('cartItems',JSON.stringify(cart().filter(p=>(p._id||p.id)!==button.dataset.id)));render();header();}
    if(action==='quantity'){const items=cart();const item=items.find(p=>(p._id||p.id)===button.dataset.id);if(item){item.quantity+=Number(button.dataset.delta);if(item.quantity<1)items.splice(items.indexOf(item),1);localStorage.setItem('cartItems',JSON.stringify(items));render();header();}}
    if(action==='page'){const params=new URLSearchParams(location.search);params.set('page',button.dataset.page);go(`${location.pathname}?${params}`);}
    if(action==='cancel-order'){if(confirm('Annuler cette commande ?')){await api(`/orders/${button.dataset.id}/cancel`,{method:'PUT'});notify('Commande annulée');render();}}
    if(action==='seller-tab'){dashboardTab=button.dataset.tab;render();}
    if(action==='admin-tab'){adminTab=button.dataset.tab;render();}
    if(action==='delete-product'){if(confirm('Supprimer ce produit ?')){await api(`/products/${button.dataset.id}`,{method:'DELETE'});notify('Produit supprimé');render();}}
    if(action==='approve-product'){const result=await api(`/products/${button.dataset.id}/approve`,{method:'PATCH'});notify(result.isApproved?'Produit publié':'Produit masqué');render();}
    if(action==='delete-user'){if(confirm('Supprimer définitivement ce compte ?')){await api(`/users/${button.dataset.id}`,{method:'DELETE'});notify('Compte supprimé');render();}}
    if(action==='toggle-announcement'){await api(`/announcements/admin/${button.dataset.id}/approve`,{method:'PUT',body:JSON.stringify({approved:button.dataset.approved!=='true'})});notify('Annonce mise à jour');render();}
    if(action==='admin-delete-announcement'){if(confirm('Supprimer cette annonce ?')){await api(`/announcements/admin/${button.dataset.id}`,{method:'DELETE'});render();}}
    if(action==='delete-announcement'){if(confirm('Supprimer cette annonce ?')){await api(`/announcements/${button.dataset.id}`,{method:'DELETE'});render();}}
    if(action==='new-announcement'){const title=prompt('Titre de l’annonce');if(title){const subtitle=prompt('Sous-titre (facultatif)')||'';await api('/announcements',{method:'POST',body:JSON.stringify({title,subtitle})});notify('Annonce soumise à validation');render();}}
    if(action==='start-chat'){const sellerId=$('#seller-pick')?.value;if(!sellerId){notify('Choisis un créateur.',true);return;}const conversation=await api('/messages/start',{method:'POST',body:JSON.stringify({sellerId})});activeConversation=conversation._id;go(`/messages?id=${conversation._id}`);}
    if(action==='contact-seller'){if(!user()){go('/connexion?redirect='+encodeURIComponent(location.pathname));return;}const conversation=await api('/messages/start',{method:'POST',body:JSON.stringify({sellerId:button.dataset.seller,productId:button.dataset.product})});go(`/messages?id=${conversation._id}`);}
  }catch(error){notify(error.message,true);}
});
document.addEventListener('submit',async event=>{
  const form=event.target;event.preventDefault();
  try{
    if(form.id==='auth-form'){
      const register=location.pathname==='/inscription';
      if(register&&!$('[name="privacyConsent"]',form)?.checked){$('#auth-error').textContent='Tu dois accepter la Politique de confidentialité pour créer un compte.';return;}
      if(!register&&!$('[name="privacyConsent"]',form)?.checked){$('#auth-error').textContent='Tu dois accepter la Politique de confidentialité pour te connecter.';return;}
      const values=serialize(form);
      const rememberMe=!register&&values.rememberMe==='on';
      delete values.rememberMe;
      values.privacyAccepted=true;values.privacyPolicyVersion='2026-10-07';delete values.privacyConsent;
      const result=await api(register?'/auth/register':'/auth/login',{method:'POST',body:JSON.stringify(values)});
      if(!result.token){$('#auth-error').textContent='Compte créé. Confirme ton adresse email, puis connecte-toi.';return;}
      storeUser(result, rememberMe ? Date.now()+REMEMBER_MS : null);const redirect=new URLSearchParams(location.search).get('redirect');go(redirect|| (result.role==='admin'?'/admin':result.role==='seller'?'/vendeur':'/'));notify('Bienvenue dans le lab.');
    }
    if(form.id==='checkout-form'){
      const address=serialize(form);const items=cart().map(item=>({productId:item._id||item.id,quantity:item.quantity}));
      const order=await api('/orders',{method:'POST',body:JSON.stringify({items,shippingAddress:address,paymentMethod:address.paymentMethod})});
      await api(`/orders/${order._id}/pay`,{method:'PUT'});localStorage.setItem('cartItems','[]');notify('Commande confirmée');go('/commandes');
    }
    if(form.id==='product-form'){
      const values=serialize(form);values.price=Number(values.price);values.stock=Number(values.stock);values.isDigital=$('[name="isDigital"]',form).checked;const id=form.dataset.id;
      await api(id?`/products/${id}`:'/products',{method:id?'PUT':'POST',body:JSON.stringify(values)});notify('Produit enregistré');go('/vendeur');
    }
    if(form.id==='review-form'){const p=location.pathname.split('/')[2];await api(`/products/${p}/reviews`,{method:'POST',body:JSON.stringify(serialize(form))});notify('Avis publié');render();}
    if(form.id==='profile-form'){const result=await api('/auth/profile',{method:'PUT',body:JSON.stringify(serialize(form))});storeUser({...user(),...result},user()?.rememberUntil||null);notify('Profil mis à jour');render();}
    if(form.id==='message-form'){await api(`/messages/${form.dataset.id}`,{method:'POST',body:JSON.stringify(serialize(form))});render();}
  }catch(error){const target=$('#auth-error')||$('#checkout-error')||$('#product-error')||$('#profile-error');if(target)target.textContent=error.message;else notify(error.message,true);}
});
document.addEventListener('change',event=>{
  if(event.target.id==='signup-role'){
    const isSeller=event.target.value==='seller';
    $('#store-name-wrap').hidden=!isSeller;
    $('#signup-store').disabled=!isSeller;
  }
  if(event.target.id==='catalog-sort'||event.target.id==='catalog-search'){
    const params=new URLSearchParams(location.search);if(event.target.value)params.set(event.target.id==='catalog-sort'?'sort':'search',event.target.value);else params.delete('search');params.delete('page');go(`${location.pathname}?${params}`);
  }
  if(event.target.matches('[data-order-status]'))api(`/orders/${event.target.dataset.orderStatus}/status`,{method:'PUT',body:JSON.stringify({status:event.target.value})}).then(()=>notify('Statut mis à jour')).catch(error=>notify(error.message,true));
});
window.addEventListener('popstate',render);
render();
