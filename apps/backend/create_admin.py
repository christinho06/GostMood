from __future__ import annotations

import getpass
import os
import re
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(Path(__file__).with_name('.env'))


def main() -> None:
    url = os.getenv('SUPABASE_URL', '').strip()
    service_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '').strip()
    if not url or not service_key or 'YOUR_' in service_key or 'your_' in service_key:
        raise SystemExit('Configurez SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans apps/backend/.env avant de continuer.')

    email = input('Email du super-admin : ').strip().lower()
    if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email):
        raise SystemExit('Adresse email invalide.')
    name = input('Nom affiché : ').strip()
    if not name:
        raise SystemExit('Le nom est obligatoire.')

    password = getpass.getpass('Mot de passe initial (12 caractères minimum) : ')
    confirmation = getpass.getpass('Confirmer le mot de passe : ')
    if len(password) < 12:
        raise SystemExit('Le mot de passe doit contenir au moins 12 caractères.')
    if password != confirmation:
        raise SystemExit('Les mots de passe ne correspondent pas.')

    client = create_client(url, service_key)
    try:
        created = client.auth.admin.create_user({
            'email': email,
            'password': password,
            'email_confirm': True,
            'user_metadata': {'name': name, 'role': 'admin'},
        })
        auth_user = created.user
        if auth_user is None:
            raise RuntimeError('Supabase n’a pas retourné le compte créé.')

        profile = client.table('profiles').select('id').eq('id', auth_user.id).limit(1).execute().data or []
        profile_data = {'id': auth_user.id, 'email': email, 'name': name, 'role': 'admin'}
        if profile:
            client.table('profiles').update({'email': email, 'name': name, 'role': 'admin'}).eq('id', auth_user.id).execute()
        else:
            client.table('profiles').insert(profile_data).execute()
    except Exception as exc:
        raise SystemExit(f'Création impossible : {exc}') from exc

    print(f'Super-admin créé : {email}')
    print('Le mot de passe n’a pas été affiché. Conservez-le dans un gestionnaire sécurisé.')


if __name__ == '__main__':
    main()
