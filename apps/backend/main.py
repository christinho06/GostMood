from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from supabase import Client, create_client

load_dotenv(Path(__file__).with_name('.env'))
ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / 'apps' / 'frontend'
SUPABASE_URL = os.getenv('SUPABASE_URL', '').strip()
ANON_KEY = os.getenv('SUPABASE_ANON_KEY', '').strip()
SERVICE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '').strip()

db: Client | None = None
if SUPABASE_URL and SERVICE_KEY:
    db = create_client(SUPABASE_URL, SERVICE_KEY)
user_auth: Client | None = None
if SUPABASE_URL and ANON_KEY:
    user_auth = create_client(SUPABASE_URL, ANON_KEY)

app = FastAPI(title='GostMood Creative Lab API', version='2.0.0')
origins = [value.strip() for value in os.getenv('CORS_ORIGINS', 'http://localhost:8000').split(',') if value.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=['*'], allow_headers=['*'])


def database() -> Client:
    if db is None:
        raise HTTPException(503, 'Supabase is not configured. Copy apps/backend/.env.example to .env and add project keys.')
    return db


def rows(table: str, *, select: str = '*', filters: dict[str, Any] | None = None, order: str | None = None, limit: int | None = None) -> list[dict[str, Any]]:
    query = database().table(table).select(select)
    for key, value in (filters or {}).items():
        query = query.eq(key, value)
    if order:
        column, direction = order.rsplit('.', 1)
        query = query.order(column, desc=direction.lower() == 'desc')
    if limit:
        query = query.limit(limit)
    return query.execute().data or []


def one(table: str, record_id: str, select: str = '*') -> dict[str, Any]:
    found = rows(table, select=select, filters={'id': record_id}, limit=1)
    if not found:
        raise HTTPException(404, 'Élément introuvable')
    return found[0]


def insert(table: str, value: dict[str, Any]) -> dict[str, Any]:
    result = database().table(table).insert(value).execute().data or []
    if not result:
        raise HTTPException(500, 'Échec de l’enregistrement')
    return result[0]


def update(table: str, record_id: str, value: dict[str, Any]) -> dict[str, Any]:
    result = database().table(table).update(value).eq('id', record_id).execute().data or []
    if not result:
        raise HTTPException(404, 'Élément introuvable')
    return result[0]


def delete(table: str, record_id: str) -> None:
    database().table(table).delete().eq('id', record_id).execute()


def camel(record: dict[str, Any] | None) -> dict[str, Any] | None:
    if record is None:
        return None
    aliases = {
        'id': '_id', 'seller_id': 'sellerId', 'buyer_id': 'buyerId', 'product_id': 'productId',
        'conversation_id': 'conversationId', 'sender_id': 'senderId', 'store_name': 'storeName',
        'store_description': 'description', 'seller_approved': 'isApproved', 'is_digital': 'isDigital',
        'musical_key': 'musicalKey', 'audio_preview': 'audioPreview', 'num_reviews': 'numReviews',
        'is_featured': 'isFeatured', 'is_approved': 'isApproved', 'created_at': 'createdAt',
        'updated_at': 'updatedAt', 'badge_color': 'badgeColor', 'start_date': 'startDate', 'end_date': 'endDate',
        'last_message': 'lastMessage', 'last_message_at': 'lastMessageAt', 'is_read': 'read',
        'shipping_address': 'shippingAddress', 'payment_method': 'paymentMethod', 'items_price': 'itemsPrice',
        'shipping_price': 'shippingPrice', 'total_price': 'totalPrice', 'is_paid': 'isPaid', 'paid_at': 'paidAt',
        'is_delivered': 'isDelivered', 'delivered_at': 'deliveredAt', 'order_id': 'orderId',
        'privacy_accepted_at': 'privacyAcceptedAt', 'privacy_policy_version': 'privacyPolicyVersion',
    }
    converted = {aliases.get(k, k): v for k, v in record.items()}
    if 'role' in converted and 'storeName' in converted:
        converted['sellerInfo'] = {
            'storeName': converted.pop('storeName'), 'description': converted.pop('description', ''),
            'isApproved': converted.pop('isApproved', False), 'earnings': converted.pop('earnings', 0),
        }
    return converted


def auth_client():
    if user_auth is None:
        raise HTTPException(503, 'Configurez SUPABASE_URL et SUPABASE_ANON_KEY dans apps/backend/.env')
    return user_auth


async def current_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith('bearer '):
        raise HTTPException(401, 'Connexion requise')
    token = authorization.split(' ', 1)[1]
    try:
        auth_user = auth_client().auth.get_user(token).user
        profile = rows('profiles', filters={'id': auth_user.id}, limit=1)
        if not profile:
            raise HTTPException(401, 'Profil introuvable')
        return profile[0]
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(401, 'Session expirée ou invalide')


def role_required(user: dict[str, Any], *roles: str) -> None:
    if user.get('role') not in roles:
        raise HTTPException(403, 'Accès refusé')


def public_profile(user_id: str | None) -> dict[str, Any] | None:
    if not user_id:
        return None
    found = rows('profiles', filters={'id': user_id}, limit=1)
    return camel(found[0]) if found else None


def product_view(product: dict[str, Any], with_reviews: bool = False) -> dict[str, Any]:
    result = camel(product) or {}
    result['seller'] = public_profile(product.get('seller_id'))
    if with_reviews:
        reviews = rows('reviews', filters={'product_id': product['id']}, order='created_at.desc')
        result['reviews'] = [{**(camel(review) or {}), 'user': public_profile(review.get('user_id'))} for review in reviews]
    return result


def order_view(order: dict[str, Any], include_buyer: bool = False) -> dict[str, Any]:
    result = camel(order) or {}
    items = rows('order_items', filters={'order_id': order['id']})
    result['items'] = [{**(camel(item) or {}), 'seller': public_profile(item.get('seller_id'))} for item in items]
    if include_buyer:
        result['buyer'] = public_profile(order.get('buyer_id'))
    return result


def auth_result(profile: dict[str, Any], session: Any) -> dict[str, Any]:
    result = camel(profile) or {}
    result.update({
        'token': session.access_token,
        'refreshToken': session.refresh_token,
        'tokenExpiresAt': session.expires_at,
    })
    return result


@app.get('/api/health')
def health():
    return {'status': 'ok', 'databaseConfigured': db is not None}


@app.get('/api/auth/google')
def google_auth(flow: str = 'login'):
    if flow not in ('login', 'signup'):
        raise HTTPException(422, 'Type de connexion invalide')
    if not SUPABASE_URL or not ANON_KEY:
        raise HTTPException(503, 'Configurez les clés Supabase avant de continuer avec Google.')
    app_url = os.getenv('APP_URL', 'http://127.0.0.1:8000').rstrip('/')
    callback = f'{app_url}/auth/callback'
    query = urlencode({'provider': 'google', 'redirect_to': callback, 'apikey': ANON_KEY})
    return RedirectResponse(f'{SUPABASE_URL}/auth/v1/authorize?{query}', status_code=302)


@app.post('/api/auth/register', status_code=201)
def register(body: dict[str, Any]):
    name, email, password = str(body.get('name', '')).strip(), str(body.get('email', '')).strip().lower(), str(body.get('password', ''))
    if not name or not email or len(password) < 8:
        raise HTTPException(422, 'Nom, email et mot de passe (8 caractères minimum) requis')
    if body.get('privacyAccepted') is not True:
        raise HTTPException(422, 'Vous devez accepter la politique de confidentialité pour créer un compte.')
    role = 'seller' if body.get('role') == 'seller' else 'buyer'
    policy_version = str(body.get('privacyPolicyVersion') or '2026-10-07')
    accepted_at = datetime.now(timezone.utc).isoformat()
    try:
        response = auth_client().auth.sign_up({'email': email, 'password': password, 'options': {'data': {'name': name, 'role': role, 'store_name': body.get('storeName') or name, 'privacy_accepted_at': accepted_at, 'privacy_policy_version': policy_version}}})
        auth_user = response.user
        if not auth_user:
            raise HTTPException(400, 'Inscription impossible')
        # Also update the profile explicitly for projects whose signup trigger predates consent columns.
        database().table('profiles').update({
            'privacy_accepted_at': accepted_at,
            'privacy_policy_version': policy_version,
        }).eq('id', auth_user.id).execute()
        # A trigger in schema.sql creates the profile even when email confirmation is enabled.
        profile = rows('profiles', filters={'id': auth_user.id}, limit=1)
        user = profile[0] if profile else {'id': auth_user.id, 'name': name, 'email': email, 'role': role, 'store_name': body.get('storeName') or name}
        if not response.session:
            raise HTTPException(202, 'Compte créé. Confirmez votre adresse email avant de vous connecter.')
        return auth_result(user, response.session)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, str(exc))


@app.post('/api/auth/login')
def login(body: dict[str, Any]):
    if body.get('privacyAccepted') is not True:
        raise HTTPException(422, 'Vous devez accepter la politique de confidentialité pour vous connecter.')
    try:
        response = auth_client().auth.sign_in_with_password({'email': body.get('email', ''), 'password': body.get('password', '')})
    except Exception:
        raise HTTPException(401, 'Email ou mot de passe incorrect')
    if not response.user or not response.session:
        raise HTTPException(401, 'Email ou mot de passe incorrect')

    try:
        profile = rows('profiles', filters={'id': response.user.id}, limit=1)
    except Exception as exc:
        raise HTTPException(503, f'Connexion réussie, mais le profil Supabase est inaccessible : {exc}')
    if not profile:
        raise HTTPException(503, 'Connexion réussie, mais aucun profil correspondant n’existe. Vérifiez le trigger profiles de schema.sql.')

    accepted_at = datetime.now(timezone.utc).isoformat()
    policy_version = str(body.get('privacyPolicyVersion') or '2026-10-07')
    try:
        accepted_profile = update('profiles', response.user.id, {
            'privacy_accepted_at': accepted_at,
            'privacy_policy_version': policy_version,
        })
    except Exception as exc:
        # Existing Supabase projects may not have re-run the schema migration yet.
        # In that case keep login working and persist the consent in trusted Auth app metadata.
        message = str(exc).lower()
        missing_consent_columns = ('privacy_accepted_at' in message or 'privacy_policy_version' in message) and ('42703' in message or 'column' in message or 'schema cache' in message)
        if not missing_consent_columns or db is None:
            raise HTTPException(503, f'Connexion réussie, mais impossible d’enregistrer le consentement : {exc}')
        try:
            auth_record = db.auth.admin.get_user_by_id(response.user.id).user
            app_metadata = dict(auth_record.app_metadata or {}) if auth_record else {}
            app_metadata['privacy_consent'] = {'acceptedAt': accepted_at, 'policyVersion': policy_version}
            db.auth.admin.update_user_by_id(response.user.id, {'app_metadata': app_metadata})
            accepted_profile = {
                **profile[0],
                'privacy_accepted_at': accepted_at,
                'privacy_policy_version': policy_version,
            }
        except Exception as fallback_exc:
            raise HTTPException(503, f'Connexion réussie, mais le consentement ne peut pas être enregistré. Exécutez apps/backend/schema.sql dans Supabase. Détail : {fallback_exc}')
    return auth_result(accepted_profile, response.session)


@app.post('/api/auth/refresh')
def refresh_auth(body: dict[str, Any]):
    refresh_token = str(body.get('refreshToken') or '').strip()
    if not refresh_token:
        raise HTTPException(422, 'Jeton de renouvellement manquant')
    try:
        response = auth_client().auth.refresh_session(refresh_token)
        if not response.session or not response.user:
            raise HTTPException(401, 'Session expirée. Connectez-vous à nouveau.')
        profile = rows('profiles', filters={'id': response.user.id}, limit=1)
        if not profile:
            raise HTTPException(401, 'Profil introuvable')
        return auth_result(profile[0], response.session)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(401, 'Session expirée. Connectez-vous à nouveau.')


@app.get('/api/auth/profile')
def get_profile(user=Depends(current_user)):
    return camel(user)


@app.post('/api/auth/oauth/complete')
def complete_google_signup(body: dict[str, Any], user=Depends(current_user)):
    flow = body.get('flow')
    if flow not in ('signup', 'login') or body.get('privacyAccepted') is not True:
        raise HTTPException(422, 'Acceptez la politique de confidentialité avant de continuer avec Google.')
    accepted_at = datetime.now(timezone.utc).isoformat()
    policy_version = str(body.get('privacyPolicyVersion') or '2026-10-07')
    changes: dict[str, Any] = {
        'privacy_accepted_at': accepted_at,
        'privacy_policy_version': policy_version,
    }
    if flow == 'signup':
        role = body.get('role') if body.get('role') in ('buyer', 'seller') else 'buyer'
        name = str(body.get('name') or user.get('name') or '').strip()
        if not name:
            raise HTTPException(422, 'Le nom est requis pour créer un compte.')
        changes.update({
            'name': name,
            'role': role,
            'store_name': str(body.get('storeName') or name) if role == 'seller' else '',
        })
    profile = update('profiles', user['id'], changes)
    return camel(profile)


@app.put('/api/auth/profile')
def edit_profile(body: dict[str, Any], user=Depends(current_user)):
    changes = {key: body[key] for key in ('name', 'avatar') if key in body}
    if 'name' in changes and not str(changes['name']).strip():
        raise HTTPException(422, 'Le nom est requis')
    updated = update('profiles', user['id'], changes) if changes else user
    if body.get('password'):
        database().auth.admin.update_user_by_id(user['id'], {'password': body['password']})
    return camel(updated)


@app.get('/api/products')
def get_products(request: Request):
    params = request.query_params
    data = rows('products', filters={})
    data = [p for p in data if p.get('is_approved')]
    category = params.get('category')
    if category:
        data = [p for p in data if p.get('category') == category]
    query = params.get('search', '').lower().strip()
    if query:
        data = [p for p in data if query in ' '.join(str(p.get(k, '')) for k in ('name', 'description', 'genre', 'brand')).lower()]
    if params.get('subcategory'):
        data = [p for p in data if p.get('subcategory') == params['subcategory']]
    if params.get('minPrice'):
        data = [p for p in data if float(p.get('price', 0)) >= float(params['minPrice'])]
    if params.get('maxPrice'):
        data = [p for p in data if float(p.get('price', 0)) <= float(params['maxPrice'])]
    sort = params.get('sort', 'newest')
    key = {'price_asc': 'price', 'price_desc': 'price', 'rating': 'rating'}.get(sort, 'created_at')
    data.sort(key=lambda p: p.get(key) or 0, reverse=sort not in ('price_asc',))
    total, page, page_size = len(data), max(1, int(params.get('page', 1))), 12
    start = (page - 1) * page_size
    return {'products': [product_view(p) for p in data[start:start + page_size]], 'page': page, 'pages': max(1, (total + page_size - 1) // page_size), 'total': total}


@app.get('/api/products/featured')
def featured_products():
    products = rows('products', filters={'is_approved': True, 'is_featured': True}, order='created_at.desc', limit=8)
    return [product_view(p) for p in products]


@app.get('/api/products/seller/myproducts')
def seller_products(user=Depends(current_user)):
    role_required(user, 'seller', 'admin')
    return [product_view(p) for p in rows('products', filters={} if user['role'] == 'admin' else {'seller_id': user['id']}, order='created_at.desc')]


@app.get('/api/products/admin/all')
def all_products(user=Depends(current_user)):
    role_required(user, 'admin')
    return [product_view(p) for p in rows('products', order='created_at.desc')]


@app.get('/api/products/{product_id}')
def product_detail(product_id: str):
    product = one('products', product_id)
    if not product.get('is_approved'):
        raise HTTPException(404, 'Produit introuvable')
    return product_view(product, with_reviews=True)


@app.post('/api/products', status_code=201)
def create_product(body: dict[str, Any], user=Depends(current_user)):
    role_required(user, 'seller', 'admin')
    required = ('name', 'description', 'price', 'category')
    if any(not body.get(key) for key in required):
        raise HTTPException(422, 'Nom, description, prix et catégorie requis')
    if body['category'] not in ('instrumental', 'equipment', 'instrument'):
        raise HTTPException(422, 'Catégorie invalide')
    record = {k: body[k] for k in ('name','description','price','category','subcategory','image','stock','isDigital','genre','bpm','musicalKey','license','audioPreview','brand','isFeatured') if k in body}
    record = {({'isDigital':'is_digital','musicalKey':'musical_key','audioPreview':'audio_preview','isFeatured':'is_featured'}.get(k, k)): v for k,v in record.items()}
    record.update({'seller_id': user['id'], 'is_approved': False, 'stock': 9999 if body.get('isDigital') else int(body.get('stock', 1))})
    return product_view(insert('products', record))


@app.put('/api/products/{product_id}')
def edit_product(product_id: str, body: dict[str, Any], user=Depends(current_user)):
    product = one('products', product_id)
    if product['seller_id'] != user['id'] and user['role'] != 'admin':
        raise HTTPException(403, 'Accès refusé')
    map_keys = {'isDigital':'is_digital','musicalKey':'musical_key','audioPreview':'audio_preview','isFeatured':'is_featured'}
    allowed = ('name','description','price','category','subcategory','image','stock','isDigital','genre','bpm','musicalKey','license','audioPreview','brand','isFeatured')
    changes = {map_keys.get(k, k): body[k] for k in allowed if k in body}
    result = update('products', product_id, changes)
    return product_view(result)


@app.delete('/api/products/{product_id}')
def remove_product(product_id: str, user=Depends(current_user)):
    product = one('products', product_id)
    if product['seller_id'] != user['id'] and user['role'] != 'admin':
        raise HTTPException(403, 'Accès refusé')
    delete('products', product_id)
    return {'message': 'Produit supprimé'}


@app.post('/api/products/{product_id}/reviews', status_code=201)
def add_review(product_id: str, body: dict[str, Any], user=Depends(current_user)):
    one('products', product_id)
    rating = int(body.get('rating', 0))
    if not 1 <= rating <= 5:
        raise HTTPException(422, 'La note doit être comprise entre 1 et 5')
    try:
        review = insert('reviews', {'product_id': product_id, 'user_id': user['id'], 'rating': rating, 'comment': str(body.get('comment', '')).strip()})
    except Exception:
        raise HTTPException(409, 'Vous avez déjà laissé un avis')
    reviews = rows('reviews', filters={'product_id': product_id})
    update('products', product_id, {'rating': sum(r['rating'] for r in reviews) / len(reviews), 'num_reviews': len(reviews)})
    return {'message': 'Avis ajouté', 'review': camel(review)}


@app.patch('/api/products/{product_id}/approve')
def approve_product(product_id: str, user=Depends(current_user)):
    role_required(user, 'admin')
    product = one('products', product_id)
    result = update('products', product_id, {'is_approved': not product['is_approved']})
    return {'isApproved': result['is_approved']}


@app.post('/api/orders', status_code=201)
def create_order(body: dict[str, Any], user=Depends(current_user)):
    items = body.get('items') or []
    if not items:
        raise HTTPException(422, 'Le panier est vide')
    # The SQL RPC locks product rows and calculates prices from the database, not from browser data.
    normalized = [{'productId': item.get('productId') or item.get('_id'), 'quantity': int(item.get('quantity', 1))} for item in items]
    if any(item['quantity'] < 1 for item in normalized):
        raise HTTPException(422, 'Quantité invalide')
    try:
        result = database().rpc('place_market_order', {'p_buyer_id': user['id'], 'p_shipping_address': body.get('shippingAddress', {}), 'p_payment_method': body.get('paymentMethod', 'simulation'), 'p_items': normalized}).execute().data
        order_id = result if isinstance(result, str) else result.get('id') if isinstance(result, dict) else result[0].get('id')
        return order_view(one('orders', order_id), include_buyer=True)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, f'Commande impossible : {exc}')


@app.get('/api/orders/myorders')
def my_orders(user=Depends(current_user)):
    return [order_view(o) for o in rows('orders', filters={'buyer_id': user['id']}, order='created_at.desc')]


@app.get('/api/orders/seller')
def seller_orders(user=Depends(current_user)):
    role_required(user, 'seller', 'admin')
    item_rows = rows('order_items', filters={} if user['role'] == 'admin' else {'seller_id': user['id']})
    order_ids = {item['order_id'] for item in item_rows}
    return [order_view(o, True) for o in rows('orders', order='created_at.desc') if o['id'] in order_ids]


@app.get('/api/orders/admin/all')
def admin_orders(user=Depends(current_user)):
    role_required(user, 'admin')
    return [order_view(o, True) for o in rows('orders', order='created_at.desc')]


@app.get('/api/orders/{order_id}')
def order_detail(order_id: str, user=Depends(current_user)):
    order = one('orders', order_id)
    if order['buyer_id'] != user['id'] and user['role'] != 'admin':
        raise HTTPException(403, 'Accès refusé')
    return order_view(order, True)


@app.put('/api/orders/{order_id}/pay')
def pay_order(order_id: str, user=Depends(current_user)):
    order = one('orders', order_id)
    if order['buyer_id'] != user['id'] and user['role'] != 'admin':
        raise HTTPException(403, 'Accès refusé')
    if order['status'] == 'cancelled':
        raise HTTPException(409, 'Cette commande a été annulée')
    result = update('orders', order_id, {'is_paid': True, 'paid_at': datetime.now(timezone.utc).isoformat(), 'status': 'processing'})
    return order_view(result)


@app.put('/api/orders/{order_id}/cancel')
def cancel_order(order_id: str, user=Depends(current_user)):
    order = one('orders', order_id)
    if order['buyer_id'] != user['id']:
        raise HTTPException(403, 'Accès refusé')
    if order['status'] not in ('pending', 'processing'):
        raise HTTPException(409, 'Cette commande ne peut plus être annulée')
    database().rpc('cancel_market_order', {'p_order_id': order_id, 'p_buyer_id': user['id']}).execute()
    return order_view(one('orders', order_id))


@app.put('/api/orders/{order_id}/status')
def set_order_status(order_id: str, body: dict[str, Any], user=Depends(current_user)):
    role_required(user, 'admin')
    status = body.get('status')
    if status not in ('pending','processing','shipped','delivered','cancelled'):
        raise HTTPException(422, 'Statut invalide')
    patch: dict[str, Any] = {'status': status, 'is_delivered': status == 'delivered'}
    if status == 'delivered':
        patch['delivered_at'] = datetime.now(timezone.utc).isoformat()
    return order_view(update('orders', order_id, patch), True)


@app.get('/api/announcements')
def announcements():
    now = datetime.now(timezone.utc).isoformat()
    data = rows('announcements', filters={'approved': True}, order='created_at.desc')
    result = []
    for item in data:
        if item.get('start_date') and item['start_date'] > now: continue
        if item.get('end_date') and item['end_date'] < now: continue
        result.append({**(camel(item) or {}), 'seller': public_profile(item.get('seller_id'))})
    return result


@app.get('/api/announcements/my')
def my_announcements(user=Depends(current_user)):
    return [{**(camel(a) or {}), 'seller': public_profile(a.get('seller_id'))} for a in rows('announcements', filters={'seller_id': user['id']}, order='created_at.desc')]


@app.post('/api/announcements', status_code=201)
def create_announcement(body: dict[str, Any], user=Depends(current_user)):
    role_required(user, 'seller', 'admin')
    if not str(body.get('title', '')).strip(): raise HTTPException(422, 'Le titre est requis')
    allowed = {'title':'title','subtitle':'subtitle','image':'image','link':'link','badge':'badge','badgeColor':'badge_color','cta':'cta','startDate':'start_date','endDate':'end_date'}
    data = {target: body[source] for source,target in allowed.items() if source in body}
    data.update({'seller_id': user['id'], 'approved': False})
    announcement = insert('announcements', data)
    return {**(camel(announcement) or {}), 'seller': camel(user)}


@app.put('/api/announcements/{announcement_id}')
def edit_announcement(announcement_id: str, body: dict[str, Any], user=Depends(current_user)):
    announcement = one('announcements', announcement_id)
    if announcement['seller_id'] != user['id'] and user['role'] != 'admin': raise HTTPException(403, 'Accès refusé')
    allowed = {'title':'title','subtitle':'subtitle','image':'image','link':'link','badge':'badge','badgeColor':'badge_color','cta':'cta','startDate':'start_date','endDate':'end_date'}
    data = {target: body[source] for source,target in allowed.items() if source in body}
    data['approved'] = False
    return {**(camel(update('announcements', announcement_id, data)) or {}), 'seller': public_profile(announcement['seller_id'])}


@app.delete('/api/announcements/{announcement_id}')
def delete_announcement(announcement_id: str, user=Depends(current_user)):
    announcement = one('announcements', announcement_id)
    if announcement['seller_id'] != user['id'] and user['role'] != 'admin': raise HTTPException(403, 'Accès refusé')
    delete('announcements', announcement_id)
    return {'message': 'Annonce supprimée'}


@app.get('/api/announcements/admin/all')
def all_announcements(user=Depends(current_user)):
    role_required(user, 'admin')
    return [{**(camel(a) or {}), 'seller': public_profile(a.get('seller_id'))} for a in rows('announcements', order='created_at.desc')]


@app.put('/api/announcements/admin/{announcement_id}/approve')
def set_announcement_approval(announcement_id: str, body: dict[str, Any], user=Depends(current_user)):
    role_required(user, 'admin')
    updated = update('announcements', announcement_id, {'approved': bool(body.get('approved'))})
    return camel(updated)


@app.delete('/api/announcements/admin/{announcement_id}')
def admin_delete_announcement(announcement_id: str, user=Depends(current_user)):
    role_required(user, 'admin')
    delete('announcements', announcement_id)
    return {'message': 'Annonce supprimée'}


@app.get('/api/users')
def users(user=Depends(current_user)):
    role_required(user, 'admin')
    return [camel(item) for item in rows('profiles', order='created_at.desc')]


@app.put('/api/users/{user_id}')
def admin_edit_user(user_id: str, body: dict[str, Any], user=Depends(current_user)):
    role_required(user, 'admin')
    patch = {}
    if body.get('role') in ('buyer','seller','admin'): patch['role'] = body['role']
    if 'sellerApproved' in body: patch['seller_approved'] = bool(body['sellerApproved'])
    return camel(update('profiles', user_id, patch))


@app.delete('/api/users/{user_id}')
def delete_user(user_id: str, user=Depends(current_user)):
    role_required(user, 'admin')
    if user_id == user['id']: raise HTTPException(400, 'Vous ne pouvez pas supprimer votre propre compte')
    try:
        database().auth.admin.delete_user(user_id)
    except Exception as exc:
        raise HTTPException(400, str(exc))
    return {'message': 'Utilisateur supprimé'}


@app.get('/api/messages/sellers')
def message_sellers(user=Depends(current_user)):
    return [camel(p) for p in rows('profiles', order='name.asc', limit=50) if p['id'] != user['id'] and p['role'] in ('seller','admin')]


@app.get('/api/messages')
def conversations(user=Depends(current_user)):
    data = [c for c in rows('conversations', order='last_message_at.desc') if user['id'] in (c['buyer_id'], c['seller_id'])]
    return [{**(camel(c) or {}), 'participants': [public_profile(c['buyer_id']), public_profile(c['seller_id'])], 'product': (camel(one('products', c['product_id'])) if c.get('product_id') else None)} for c in data]


@app.get('/api/messages/unread')
def unread(user=Depends(current_user)):
    conv_ids = [c['id'] for c in rows('conversations') if user['id'] in (c['buyer_id'], c['seller_id'])]
    messages = rows('messages', filters={'is_read': False})
    return {'count': sum(1 for m in messages if m['conversation_id'] in conv_ids and m['sender_id'] != user['id'])}


@app.post('/api/messages/start')
def start_conversation(body: dict[str, Any], user=Depends(current_user)):
    seller_id, product_id = body.get('sellerId'), body.get('productId')
    if not seller_id or seller_id == user['id']: raise HTTPException(422, 'Vendeur invalide')
    seller = one('profiles', seller_id)
    if seller['role'] not in ('seller','admin'): raise HTTPException(422, 'Ce profil ne peut pas recevoir de messages vendeur')
    if user['role'] == 'seller':
        buyer_id, seller_id = seller_id, user['id']
    else:
        buyer_id = user['id']
    existing = [c for c in rows('conversations') if c['buyer_id'] == buyer_id and c['seller_id'] == seller_id and c.get('product_id') == product_id]
    conv = existing[0] if existing else insert('conversations', {'buyer_id': buyer_id, 'seller_id': seller_id, 'product_id': product_id})
    return {**(camel(conv) or {}), 'participants': [public_profile(buyer_id), public_profile(seller_id)]}


def conversation_for(conversation_id: str, user: dict[str, Any]) -> dict[str, Any]:
    conversation = one('conversations', conversation_id)
    if user['id'] not in (conversation['buyer_id'], conversation['seller_id']): raise HTTPException(403, 'Accès refusé')
    return conversation


@app.get('/api/messages/{conversation_id}')
def get_messages(conversation_id: str, user=Depends(current_user)):
    conversation = conversation_for(conversation_id, user)
    data = rows('messages', filters={'conversation_id': conversation_id}, order='created_at.asc')
    for msg in data:
        if msg['sender_id'] != user['id'] and not msg['is_read']:
            update('messages', msg['id'], {'is_read': True})
            msg['is_read'] = True
    return [{**(camel(m) or {}), 'sender': public_profile(m['sender_id'])} for m in data]


@app.post('/api/messages/{conversation_id}', status_code=201)
def send_message(conversation_id: str, body: dict[str, Any], user=Depends(current_user)):
    conversation = conversation_for(conversation_id, user)
    content = str(body.get('content', '')).strip()
    if not content: raise HTTPException(422, 'Le message ne peut pas être vide')
    message = insert('messages', {'conversation_id': conversation_id, 'sender_id': user['id'], 'content': content})
    update('conversations', conversation_id, {'last_message': content[:180], 'last_message_at': datetime.now(timezone.utc).isoformat()})
    return {**(camel(message) or {}), 'sender': camel(user)}


@app.post('/api/upload/{kind}')
def upload_file(kind: str, file: UploadFile = File(...), user=Depends(current_user)):
    if kind not in ('image', 'audio'): raise HTTPException(404, 'Type de fichier invalide')
    max_size = 10 * 1024 * 1024 if kind == 'image' else 150 * 1024 * 1024
    content = file.file.read(max_size + 1)
    if len(content) > max_size: raise HTTPException(413, 'Fichier trop volumineux')
    if kind == 'image' and not (file.content_type or '').startswith('image/'): raise HTTPException(415, 'Image requise')
    if kind == 'audio' and not (file.content_type or '').startswith('audio/'): raise HTTPException(415, 'Fichier audio requis')
    bucket = os.getenv('SUPABASE_STORAGE_BUCKET', 'marketplace-media')
    suffix = Path(file.filename or 'upload').suffix[:12]
    object_name = f'{user["id"]}/{kind}/{datetime.now(timezone.utc).timestamp():.0f}{suffix}'
    try:
        database().storage.from_(bucket).upload(object_name, content, {'content-type': file.content_type or 'application/octet-stream', 'upsert': 'true'})
        return {'url': database().storage.from_(bucket).get_public_url(object_name)}
    except Exception as exc:
        raise HTTPException(400, f'Configurez le bucket Supabase Storage « {bucket} » : {exc}')


if FRONTEND.exists():
    app.mount('/assets', StaticFiles(directory=str(FRONTEND / 'assets')), name='assets')

    @app.get('/{full_path:path}', include_in_schema=False)
    def frontend_routes(full_path: str):
        if full_path.startswith('api/'):
            raise HTTPException(404, 'Route API introuvable')
        return FileResponse(FRONTEND / 'index.html')
