# GostMood Creative Lab

Marketplace musical migré vers **HTML + Tailwind CSS + JavaScript natif + GSAP/ScrollTrigger**, **Python/FastAPI** et **Supabase PostgreSQL**. FastAPI sert à la fois l'API JSON et l'application web statique.

## Accès et identifiants Supabase

Les accès réels au projet ne peuvent pas être renseignés ici : aucun projet Supabase ni identifiant ne m'a été communiqué. Pour des raisons de sécurité, ne publiez jamais de mot de passe, clé secrète ou chaîne de connexion dans ce README.

1. Créez ou ouvrez votre projet sur [supabase.com/dashboard](https://supabase.com/dashboard).
2. Dans **Project Settings → API**, copiez le **Project URL**, la clé publique **publishable/anon**, et la clé serveur **secret/service_role**.
3. Copiez `apps/backend/.env.example` vers `apps/backend/.env`, puis renseignez ces valeurs dans ce fichier local non versionné :

	- `SUPABASE_URL` — URL du projet.
	- `SUPABASE_ANON_KEY` — clé publique utilisée par FastAPI pour vérifier l'authentification.
	- `SUPABASE_SERVICE_ROLE_KEY` — clé privée côté serveur, requise pour l'accès DB et l'administration. **Ne jamais l'ajouter au frontend, à Git ou à ce README.**

Le tableau de bord Supabase est l'interface d'administration de la base. L'application locale sera disponible à `http://localhost:8000`; la documentation FastAPI à `http://localhost:8000/docs`.

## Installation locale (Windows PowerShell)

Depuis la racine du projet :

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
py -m pip install -r apps/backend/requirements.txt
Copy-Item apps/backend/.env.example apps/backend/.env
```

Après avoir renseigné `apps/backend/.env`, créez le schéma : dans le Dashboard Supabase, ouvrez **SQL Editor → New query**, collez tout le contenu de `apps/backend/schema.sql` et exécutez-le. Ce script crée les tables, le profil lié à Supabase Auth, les index et les fonctions transactionnelles de commande/stock.

Puis démarrez le site et l'API ensemble :

```powershell
py -m uvicorn apps.backend.main:app --reload --port 8000
```

Ouvrez ensuite `http://localhost:8000`. Le frontend ne nécessite ni Node.js, ni compilation Vite; Tailwind, GSAP et ScrollTrigger sont chargés depuis leurs CDN. Une connexion Internet est nécessaire pour ces bibliothèques et les polices distantes.

## Configuration de stockage (facultatif)

Pour les téléchargements d'images/audio, créez dans **Storage** un bucket public nommé `marketplace-media`. Le nom peut être changé avec `SUPABASE_STORAGE_BUCKET` dans `apps/backend/.env`. Limites API : 10 Mo par image et 150 Mo par audio. Les produits peuvent également référencer directement des URLs d'image et d'aperçu audio.

## Connexion Google (OAuth)

Pour activer les boutons Google, configurez le fournisseur dans Supabase :

1. Ouvrez **Authentication → Sign In / Providers → Google** et activez Google.
2. Dans Google Cloud Console, créez un client OAuth de type application Web. Comme URI de redirection autorisée chez Google, ajoutez l’URL de callback affichée par Supabase dans les paramètres du fournisseur Google (format `https://<référence-du-projet>.supabase.co/auth/v1/callback`).
3. Copiez le Client ID et le Client Secret Google dans les champs demandés par Supabase, puis enregistrez.
4. Dans **Authentication → URL Configuration → Redirect URLs**, autorisez `http://127.0.0.1:8000/auth/callback` et `http://localhost:8000/auth/callback`. En production, ajoutez aussi l’URL publique de l’application suivie de `/auth/callback` et définissez `APP_URL` dans `apps/backend/.env`.

La création via Google est disponible à la troisième étape d’inscription, après le consentement de confidentialité. Le bouton Google de connexion ne crée pas de session locale pour un profil sans consentement enregistré; dans ce cas, passez par « Créer un compte » et validez la politique.

## Connexion des comptes et premier super-admin

L'inscription et la connexion utilisent Supabase Auth. Avant de créer des comptes, renseignez `SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` dans `apps/backend/.env`, puis exécutez le schéma SQL ci-dessus. Les clés se récupèrent dans **Supabase → Project Settings → API**. L'application ne contient aucun compte ni mot de passe par défaut.

Pour créer le premier compte administrateur, démarrez le script depuis la racine :

```powershell
py apps/backend/create_admin.py
```

Le script demande un email, un nom et un mot de passe dans le terminal (12 caractères minimum), puis crée et confirme le compte Supabase Auth et lui attribue le rôle `admin`. Le mot de passe n'est ni affiché ni enregistré par le script. Connectez-vous ensuite avec cet email et ce mot de passe via `/connexion`.

Pour promouvoir un compte existant depuis **SQL Editor**, après avoir remplacé l'adresse :

```sql
update public.profiles
set role = 'admin'
where email = 'votre-adresse@example.com';
```

La création d'un compte vendeur est proposée à l'inscription. Les vendeurs peuvent publier des produits en attente de validation par un administrateur. L'authentification et les rôles sont vérifiés côté FastAPI.

## Fonctionnalités migrées

- Catalogue filtrable, fiches produit, avis et aperçu audio.
- Inscription/connexion par Supabase Auth, profil et rôles acheteur/vendeur/admin.
- Option « Se souvenir de moi » qui conserve et renouvelle la session sur cet appareil, jusqu’à 30 jours; sans cette option, la session reste limitée à l’onglet.
- Consentement obligatoire à la politique de confidentialité à l’inscription (acheteur comme vendeur) et à chaque connexion, horodaté et versionné dans le profil Supabase.
- Panier local, commandes, vérification de stock et calcul des tarifs côté serveur.
- Espace vendeur pour ses produits, commandes et annonces.
- Console admin pour les utilisateurs, publications, annonces et statuts de commande.
- Conversations et messagerie.
- Interface responsive animée avec GSAP et ScrollTrigger.

Le paiement reste une **simulation**, comme dans le projet précédent : aucun prestataire de paiement ni débit réel n'est configuré.

## Structure

- `apps/frontend/index.html` — document HTML de l'application.
- `apps/frontend/assets/` — Tailwind (CDN), styles personnalisés, JavaScript natif, animations GSAP.
- `apps/backend/main.py` — API FastAPI, Supabase Auth/DB/Storage, service du frontend.
- `apps/backend/schema.sql` — schéma et fonctions PostgreSQL à exécuter dans Supabase.
- `apps/backend/requirements.txt` — dépendances Python.
- `apps/backend/.env.example` — modèle de configuration sans secrets.

## Routes API utiles

L'API conserve les routes historiques sous `/api` : auth, produits, commandes, annonces, utilisateurs, messages et uploads. `GET /api/health` donne l'état de configuration, et `/docs` liste les routes OpenAPI.

### Consentement de confidentialité

La case de consentement est obligatoire pour toute inscription et connexion; FastAPI la vérifie également et enregistre la date/version acceptée dans le profil. Le lien de pied de page ouvre seulement la politique pour lecture; l’acceptation se fait depuis la case du formulaire. Le choix de cookies est enregistré par le bandeau popup et n’a pas de contrôle de revalidation dans le pied de page. Après mise à jour du projet, réexécutez `apps/backend/schema.sql` dans le SQL Editor Supabase pour ajouter les colonnes de consentement aux bases déjà créées. Le texte fourni dans l’application est une base à faire vérifier et compléter avec les coordonnées du responsable de traitement avant mise en production.
