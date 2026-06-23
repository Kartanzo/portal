import os
import json
import html
import smtplib
import textwrap
from typing import List, Optional
from datetime import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from db_utils import get_db_connection
from core.config import FRONTEND_URL, API_URL


def send_email(to_email, subject, body_html):
    try:
        # Load credentials
        gmail_user = os.environ.get("GMAIL_USER")
        gmail_password = os.environ.get("GMAIL_PASSWORD")

        if not gmail_user or not gmail_password:
             if os.path.exists("cred.json"):
                with open("cred.json") as f:
                    creds = json.load(f)
                gmail_user = creds.get('gmail')
                gmail_password = creds.get('passwordGmail')

        if not gmail_user or not gmail_password:
             print("Email credentials not found.")
             return

        msg = MIMEMultipart()
        msg['From'] = str(gmail_user)
        msg['To'] = str(to_email)
        msg['Subject'] = str(subject)
        msg.attach(MIMEText(str(body_html), 'html'))

        # Connect using TLS
        server = smtplib.SMTP('smtp.gmail.com', 587, timeout=10)
        server.starttls()
        server.login(str(gmail_user), str(gmail_password))
        text = msg.as_string()
        server.sendmail(str(gmail_user), str(to_email), text)
        server.close()
        print(f"Email sent to {to_email}")
    except Exception as e:
        print(f"Failed to send email: {e}")
        # Don't raise, just log


def generate_email_html(email_title, recipient_name, friendly_id, ticket_title, status, category, requester_name, created_at, message, link, updated_at=None, ticket_id=None):

    # Format dates
    created_str = created_at.strftime("%d/%m/%Y %H:%M") if isinstance(created_at, datetime) else str(created_at) if created_at else "N/A"
    updated_str = updated_at.strftime("%d/%m/%Y %H:%M") if isinstance(updated_at, datetime) else (str(updated_at) if updated_at else "-")

    # Process Message (break long words/lines and handle newlines for HTML)
    processed_message = ""
    if message:
        # 1. Escape HTML to prevent layout breakage
        escaped_message = html.escape(str(message))

        # 2. Handle wrapping for very long words
        wrapped_lines: List[str] = []
        for line in escaped_message.splitlines():
             if line.strip():
                 wrapped_lines.append(textwrap.fill(line, width=100, break_long_words=True))
             else:
                 wrapped_lines.append("")

        # 3. Join with <br> for consistent email client rendering
        processed_message = "<br>".join(wrapped_lines)

    # Use FRONTEND_URL for the button
    full_link = f"{FRONTEND_URL.rstrip('/')}{link}"

    # Custom Content for Validation
    validation_buttons = ""
    print(f"DEBUG EMAIL: Generating email for status '{status}'")

    # Check status with strip to be safe
    if status and status.strip() == 'Em Validação':
        print("DEBUG EMAIL: Adding validation buttons")

        real_ticket_id = ticket_id
        if not real_ticket_id and "/tickets/" in link:
             real_ticket_id = link.split("/tickets/")[1]

        # Usa FRONTEND_URL + /api/ (proxy nginx) — funciona independente de como API_URL esta configurado
        approve_link = f"{FRONTEND_URL.rstrip('/')}/api/public/tickets/{real_ticket_id}/approve"
        disapprove_link = f"{full_link}?action=disapprove"
        validation_buttons = f"""
        <div style="margin-top: 32px; background-color: #fef2f2; border: 2px solid #fee2e2; border-radius: 12px; padding: 24px; text-align: center;">
            <h3 style="margin: 0 0 16px 0; color: #991b1b; font-size: 18px; font-weight: bold; text-transform: uppercase;">⚠️ Ação Necessária</h3>

            <p style="margin-bottom: 8px; font-size: 16px; color: #7f1d1d; font-weight: bold;">
                Precisa de Validação
            </p>
            <p style="margin-bottom: 24px; font-size: 14px; color: #7f1d1d; line-height: 1.5;">
                Por favor, confirme se a solução atende sua solicitação.<br>
                <strong>O sistema encerrará este chamado automaticamente em 5 dias úteis se não houver resposta.</strong>
            </p>

            <div>
                <a href="{approve_link}" style="background-color: #16a34a; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; margin: 0 10px; display: inline-block; border: 1px solid #15803d; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">✅ APROVAR</a>
                <a href="{disapprove_link}" style="background-color: #ffffff; color: #dc2626; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; margin: 0 10px; display: inline-block; border: 2px solid #dc2626; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">❌ REPROVAR</a>
            </div>
            <p style="margin-top: 16px; font-size: 12px; color: #999;">Ao clicar em Reprovar, você será direcionado ao portal para informar o motivo.</p>
        </div>
        """

    return f"""
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 650px; margin: 0 auto; background-color: #ffffff; color: #333333; border: 1px solid #e0e0e0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        <div style="background-color: #dc2626; padding: 24px; text-align: center;">
            <h2 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 600;">{email_title}: {friendly_id}</h2>
        </div>
        <div style="padding: 32px;">
            <p style="font-size: 16px; margin-bottom: 24px; color: #555;">Olá, <strong>{recipient_name}</strong>,</p>

            {validation_buttons}

            <table style="width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 24px; border: 1px solid #f0f0f0; border-radius: 8px; overflow: hidden;">
                <tr style="background-color: #fafafa;">
                    <td style="padding: 12px 16px; border-bottom: 1px solid #f0f0f0; width: 30%; font-weight: 600; color: #666;">Título</td>
                    <td style="padding: 12px 16px; border-bottom: 1px solid #f0f0f0; color: #333;">{ticket_title}</td>
                </tr>
                <tr>
                    <td style="padding: 12px 16px; border-bottom: 1px solid #f0f0f0; font-weight: 600; color: #666;">Solicitante</td>
                    <td style="padding: 12px 16px; border-bottom: 1px solid #f0f0f0; color: #333;">{requester_name}</td>
                </tr>
                <tr style="background-color: #fafafa;">
                    <td style="padding: 12px 16px; border-bottom: 1px solid #f0f0f0; font-weight: 600; color: #666;">Categoria</td>
                    <td style="padding: 12px 16px; border-bottom: 1px solid #f0f0f0; color: #333;">{category}</td>
                </tr>
                <tr>
                    <td style="padding: 12px 16px; border-bottom: 1px solid #f0f0f0; font-weight: 600; color: #666;">Status</td>
                    <td style="padding: 12px 16px; border-bottom: 1px solid #f0f0f0; color: #333;">
                        <span style="background-color: #eee; padding: 4px 8px; border-radius: 4px; font-size: 14px; font-weight: 600;">{status}</span>
                    </td>
                </tr>
                 <tr style="background-color: #fafafa;">
                    <td style="padding: 12px 16px; border-bottom: 1px solid #f0f0f0; font-weight: 600; color: #666;">Abertura</td>
                    <td style="padding: 12px 16px; border-bottom: 1px solid #f0f0f0; color: #333;">{created_str}</td>
                </tr>
                <tr>
                    <td style="padding: 12px 16px; font-weight: 600; color: #666;">Última Atualização</td>
                    <td style="padding: 12px 16px; color: #333;">{updated_str}</td>
                </tr>
            </table>

            <div style="margin-bottom: 32px;">
                <p style="font-weight: 600; margin-bottom: 12px; color: #444; border-bottom: 2px solid #dc2626; display: inline-block; padding-bottom: 4px;">Mensagem / Observação</p>
                <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; border-left: 4px solid #dc2626; word-break: break-word; overflow-wrap: anywhere; font-family: Consolas, Monaco, 'Courier New', monospace; font-size: 14px; color: #444; line-height: 1.6;">{processed_message}</div>
            </div>

            <div style="text-align: center; margin-top: 40px;">
                <a href="{full_link}" style="background-color: #dc2626; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block; box-shadow: 0 2px 5px rgba(220, 38, 38, 0.3);">Ver Detalhes do Chamado</a>
            </div>
        </div>
        <div style="background-color: #f4f4f4; padding: 20px; text-align: center; font-size: 12px; color: #999; border-top: 1px solid #e0e0e0;">
            <p style="margin: 0; margin-bottom: 8px;">Sistema de Chamados 3LACKD</p>
            <p style="margin: 0;">Este é um e-mail automático, por favor não responda.</p>
        </div>
    </div>
    """


def notify_user(user_id, title, message, link, conn=None, email_html=None):
    should_close = False
    if conn is None:
        try:
            conn = get_db_connection()
            should_close = True
        except:
            return

    try:
        cur = conn.cursor()
        # Fetch user prefs & email & name
        cur.execute("SELECT email, notification_preferences, name, role FROM users WHERE id = %s", (str(user_id),))
        row = cur.fetchone()
        if not row:
            if should_close: conn.close()
            return

        email = row[0]
        prefs = row[1] if row[1] else {"email": True, "sound": True, "desktop": True}
        user_name = row[2] if row[2] else "Usuário"
        user_role = row[3]

        # CEO does not receive emails
        if user_role == 'ceo':
            if should_close: conn.close()
            return

        # Insert Notification (Always inserts into DB regardless of email pref, unless we want to block that too? Usually we keep in-app notifs)
        cur.execute("""
            INSERT INTO notifications (user_id, title, message, link)
            VALUES (%s, %s, %s, %s)
        """, (str(user_id), title, message, link))
        conn.commit()

        # Send Email
        # Reverted strict check as per user request.
        # Defaulting to True if key missing.
        if prefs.get('email', True):
            try:
                # Prepare HTML
                final_html = None
                if email_html:
                    # Treat recipient_name as a placeholder or replacement
                    final_html = email_html.replace("{recipient_name}", user_name)
                    # If the standard template is used, {recipient_name} is used.
                    # If legacy html is used, it might not have it, but replace is safe.

                # Basic email body fallback or rich html
                body = ""
                if final_html:
                    body = final_html
                else:
                     # Fallback using FRONTEND_URL
                     full_link = f"{FRONTEND_URL.rstrip('/')}{link}"
                     body = f"""
                        <html><body>
                            <h2>{title}</h2>
                            <p>{message}</p>
                            <p><a href="{full_link}" style="background-color: #dc2626; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Ver Detalhes</a></p>
                        </body></html>
                     """

                send_email(email, title, body)
            except Exception as e:
                print(f"Failed to send email notification: {e}")

    except Exception as e:
        print(f"Notify Error: {e}")
    finally:
        if should_close:
            conn.close()


def notify_admins(title, message, link, conn=None, email_html=None, target_sector=None, exclude_user_id=None):
    should_close = False
    if conn is None:
        try:
            conn = get_db_connection()
            should_close = True
        except:
            return

    try:
        cur = conn.cursor()

        # Build query based on target_sector
        if target_sector:
            # Normalize for comparison
            ts = target_sector.strip().lower()
            # Logic: Send to Super Users OR Admins who match the sector
            query = """
                SELECT id FROM users
                WHERE is_active = TRUE AND (
                    role = 'super_user'
                    OR (role = 'admin' AND (
                        sector ILIKE %s
                        OR managed_sectors ILIKE %s
                    ))
                )
            """
            cur.execute(query, (target_sector, f"%{target_sector}%"))
        else:
            # Fallback: generically for backward compat
            cur.execute("SELECT id FROM users WHERE role IN ('admin', 'super_user') AND is_active = TRUE")

        rows = cur.fetchall()
        for row in rows:
            # Pula o proprio autor para evitar notificacao duplicada (admin que cria proprio chamado)
            if exclude_user_id and str(row[0]) == str(exclude_user_id):
                continue
            notify_user(row[0], title, message, link, conn, email_html)
    except Exception as e:
        print(f"Notify Admins Error: {e}")
    finally:
        if should_close:
            conn.close()


def send_action_plan_email(bg_tasks, subject, title, lines, recipients_users_ids=None, recipients_names=None):
    """
    Sends email to a list of user_ids and/or names (resolved to emails).
    recipients_users_ids: List of UUID strings
    recipients_names: List of strings (names)
    """
    if not bg_tasks: return

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Set of tuples: (email, name, role, prefs_dict)
        potential_recipients = []

        # Resolve IDs
        if recipients_users_ids:
            for uid in recipients_users_ids:
                if not uid: continue
                cur.execute("SELECT email, name, role, notification_preferences FROM users WHERE id = %s", (str(uid),))
                row = cur.fetchone()
                if row:
                    potential_recipients.append(row)

        # Resolve Names (Responsible often stored as names)
        if recipients_names:
            for name in recipients_names:
                if not name: continue
                # Try exact match first
                cur.execute("SELECT email, name, role, notification_preferences FROM users WHERE name ILIKE %s", (name,))
                row = cur.fetchone()
                if row:
                    potential_recipients.append(row)

        # Filter and Deduplicate
        unique_recipients = {} # email -> name keys to deduplicate by email

        for p_row in potential_recipients:
            email, user_name, role, prefs = p_row

            # 1. Check CEO Role
            if role == 'ceo':
                 continue

            # 2. Check Notification Preferences
            if prefs and isinstance(prefs, dict):
                 if not prefs.get('email', True):
                      continue

            # Add to unique list (lowercase email for integrity)
            if email:
                unique_recipients[email.lower()] = (email, user_name)

        # Send
        for email, user_name in unique_recipients.values():

            portal_link = FRONTEND_URL.rstrip('/') + "/#/action-plan" # Deep link if possible

            body_html = f"""
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; color: #333333; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
                <div style="background-color: #0f172a; padding: 20px; text-align: center;">
                    <h2 style="color: #ffffff; margin: 0;">Plano de Ação</h2>
                </div>
                <div style="padding: 24px;">
                    <p style="font-size: 16px; margin-bottom: 24px;">Olá, <strong>{user_name}</strong>,</p>

                    <h3 style="color: #0f172a; border-bottom: 1px solid #eee; padding-bottom: 10px;">{title}</h3>

                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
                        {"".join([f'<tr><td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0; font-weight: bold; width: 30%;">{line[0]}:</td><td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">{line[1]}</td></tr>' for line in lines])}
                    </table>

                    <div style="text-align: center; margin-top: 32px;">
                        <a href="{portal_link}" style="background-color: #0f172a; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Acessar Painel</a>
                    </div>
                </div>
                <div style="background-color: #f8f8f8; padding: 16px; text-align: center; font-size: 12px; color: #888888; border-top: 1px solid #e0e0e0;">
                    <p style="margin: 0;">Sistema de Gestão 3LACKD</p>
                </div>
            </div>
            """
            bg_tasks.add_task(send_email, email, subject, body_html)
    except Exception as e:
        print(f"Error preparing action plan emails: {e}")
    finally:
        cur.close()
        conn.close()


def send_implementation_schedule_email(bg_tasks, subject, title, lines, recipients_users_ids=None, recipients_names=None):
    """
    Sends email to a list of user_ids and/or names (resolved to emails).
    recipients_users_ids: List of UUID strings
    recipients_names: List of strings (names)
    """
    if not bg_tasks: return

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Set of tuples: (email, name, role, prefs_dict)
        potential_recipients = []

        # Resolve IDs
        if recipients_users_ids:
            for uid in recipients_users_ids:
                if not uid: continue
                cur.execute("SELECT email, name, role, notification_preferences FROM users WHERE id = %s", (str(uid),))
                row = cur.fetchone()
                if row:
                    potential_recipients.append(row)

        # Resolve Names
        if recipients_names:
            for name in recipients_names:
                if not name: continue
                cur.execute("SELECT email, name, role, notification_preferences FROM users WHERE name ILIKE %s", (name,))
                row = cur.fetchone()
                if row:
                    potential_recipients.append(row)

        # Filter and Deduplicate
        unique_recipients = {}
        for p_row in potential_recipients:
            email, user_name, role, prefs = p_row
            if role == 'ceo': continue
            if prefs and isinstance(prefs, dict):
                if not prefs.get('email', True): continue
            if email:
                unique_recipients[email.lower()] = (email, user_name)

        # Send
        for email, user_name in unique_recipients.values():
            portal_link = FRONTEND_URL.rstrip('/') + "/#/implementation-schedule"

            body_html = f"""
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; color: #333333; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
                <div style="background-color: #1e293b; padding: 20px; text-align: center;">
                    <h2 style="color: #ffffff; margin: 0;">Cronograma de Implementação</h2>
                </div>
                <div style="padding: 24px;">
                    <p style="font-size: 16px; margin-bottom: 24px;">Olá, <strong>{user_name}</strong>,</p>
                    <h3 style="color: #1e293b; border-bottom: 1px solid #eee; padding-bottom: 10px;">{title}</h3>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
                        {"".join([f'<tr><td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0; font-weight: bold; width: 30%;">{line[0]}:</td><td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">{line[1]}</td></tr>' for line in lines])}
                    </table>
                    <div style="text-align: center; margin-top: 32px;">
                        <a href="{portal_link}" style="background-color: #1e293b; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Acessar Painel</a>
                    </div>
                </div>
                <div style="background-color: #f8f8f8; padding: 16px; text-align: center; font-size: 12px; color: #888888; border-top: 1px solid #e0e0e0;">
                    <p style="margin: 0;">Sistema de Gestão 3LACKD</p>
                </div>
            </div>
            """
            bg_tasks.add_task(send_email, email, subject, body_html)
    except Exception as e:
        print(f"Error preparing implementation schedule emails: {e}")
    finally:
        cur.close()
        conn.close()
