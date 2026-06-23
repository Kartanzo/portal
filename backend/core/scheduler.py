import asyncio
import logging
from datetime import datetime
from starlette.concurrency import run_in_threadpool

from db_utils import get_db_connection

logger = logging.getLogger(__name__)


def auto_close_inactive_tickets():
    """
    Automatically closes tickets in 'Em Validação' status after 5 business days without response.

    This function runs every hour (Mon-Fri) to check if any tickets have exceeded the 5 business day limit.
    The 5-day count starts from the last USER interaction (excluding system messages).

    Example: If a ticket enters "Em Validação" on 20/03 at 15:00, it should be closed on 25/03
    after the scheduler runs (within 1 hour after 15:00).
    """
    try:
        conn = get_db_connection()
        process_auto_closure(conn)
        conn.close()
    except Exception as e:
        logger.error(f"Error in auto_close_inactive_tickets: {e}")


def process_auto_closure(conn):
    """
    Automatically closes tickets in 'Em Validação' status after 5 business days without response.
    """
    try:
        with conn.cursor() as cur:
            # Query tickets that have been in 'Em Validação' for >= 5 business days
            # Uses the last USER message (is_system = FALSE), not system messages
            query = """
                SELECT t.id
                FROM tickets t
                WHERE t.status = 'Em Validação'
                AND t.is_active = TRUE
                AND (
                    -- Get last user interaction date (excluding system messages)
                    SELECT count(*)
                    FROM generate_series(
                        COALESCE(
                            (SELECT MAX(tu.created_at)::date
                             FROM ticket_updates tu
                             WHERE tu.ticket_id = t.id
                             AND (tu.is_system = FALSE OR tu.is_system IS NULL)
                            ),
                            t.updated_at::date
                        ) + 1,
                        CURRENT_DATE,
                        '1 day'::interval
                    ) AS day
                    WHERE extract(dow from day) NOT IN (0, 6)
                ) >= 5
            """
            cur.execute(query)
            expired_ids = [str(r[0]) for r in cur.fetchall()]

            if not expired_ids:
                return

            for tid in expired_ids:
                logger.info(f"Auto-closing ticket {tid} due to inactivity.")

                # Update status to Concluído
                cur.execute("UPDATE tickets SET status = 'Concluído', updated_at = NOW() WHERE id = %s", (tid,))

                # Add system log entry
                msg = "✅ Chamado concluído automaticamente pelo sistema após 5 dias úteis sem resposta."
                cur.execute("""
                    INSERT INTO ticket_updates (ticket_id, user_id, message, created_at, is_system)
                    VALUES (%s, NULL, %s, NOW(), TRUE)
                """, (tid, msg))

            conn.commit()
    except Exception as e:
        logger.error(f"Error in process_auto_closure: {e}")
        conn.rollback()


async def daily_alert_scheduler():
    print("Auto-close Scheduler started (runs every hour)...")

    # Track last execution to avoid duplicate runs
    last_execution_hour = None

    while True:
        try:
            now = datetime.now()
            current_hour = now.hour

            # Run every hour on weekdays (Mon-Fri), but only once per hour
            if now.weekday() < 5 and last_execution_hour != current_hour:
                # Check if we're at the start of a new hour (within first 5 minutes)
                if now.minute < 5:
                    print(f"[{now.strftime('%Y-%m-%d %H:%M:%S')}] Triggering auto-close check...")
                    await run_in_threadpool(auto_close_inactive_tickets)
                    last_execution_hour = current_hour
                    print(f"[{now.strftime('%Y-%m-%d %H:%M:%S')}] Auto-close check completed. Next check in 1 hour.")
                    # Sleep for 5 minutes to avoid double trigger
                    await asyncio.sleep(300)

            # Sleep for 1 minute before checking again
            await asyncio.sleep(60)

        except Exception as e:
            logger.error(f"Scheduler error: {e}")
            await asyncio.sleep(60)


def start_scheduler():
    """Called from lifespan — schedules the daily alert task."""
    asyncio.create_task(daily_alert_scheduler())
