-- CAFÉ ELITE — FIVE-DIGIT STAFF/CUSTOMER ORDER REFERENCE
-- OFFLINE LOCKED DRAFT. NOT AUTHORISED for live execution.
-- Preserve primary UUID ID, order_data, Stripe metadata, event ledger and payment references.
-- Before any actual production use: fresh verified backup, current row-count check,
-- cutover maintenance window, separate explicit migration approval and stop-on-error.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '50s';
SET LOCAL idle_in_transaction_session_timeout = '55s';
SET LOCAL search_path = pg_catalog;
SET LOCAL cafe_elite.target_ref = 'UNCONFIRMED';
SET LOCAL cafe_elite.owner_approval = 'NOT_APPROVED';

LOCK TABLE public.cafe_elite_orders IN ACCESS EXCLUSIVE MODE;

DO $preflight$
DECLARE before_digest text;
BEGIN
  IF current_setting('cafe_elite.target_ref') <> 'xpagffhrtsncrraftnpq'
    OR current_setting('cafe_elite.owner_approval') <> 'OWNER_APPROVED_FIVE_DIGIT_REFERENCE' THEN
    RAISE EXCEPTION 'Target project and explicit owner migration approval required';
  END IF;
  IF current_database() <> 'postgres'
    OR current_setting('server_version_num')::int / 10000 <> 17 THEN
    RAISE EXCEPTION 'Wrong database or PostgreSQL major version';
  END IF;
  IF pg_catalog.to_regclass('public.cafe_elite_orders') IS NULL
    OR pg_catalog.to_regclass('public.cafe_elite_order_number_seq') IS NOT NULL
    OR EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='cafe_elite_orders'
        AND column_name='order_number') THEN
    RAISE EXCEPTION 'Order number migration already applied or schema mismatch';
  END IF;
  IF (SELECT count(*) FROM public.cafe_elite_orders) <> __EXPECTED_ORDER_COUNT__
    OR (SELECT count(*) FROM public.cafe_elite_orders) > 90000 THEN
    RAISE EXCEPTION 'Order count changed; re-audit before migration';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class
      WHERE oid='public.cafe_elite_orders'::regclass AND relrowsecurity)
    OR NOT EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='cafe_elite_orders' AND column_name='revision') THEN
    RAISE EXCEPTION 'Hardened existing orders table missing';
  END IF;
  SELECT encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.string_agg(pg_catalog.to_jsonb(o)::text, E'\n' ORDER BY o.id),'UTF8')),'hex')
    INTO before_digest FROM public.cafe_elite_orders o;
  PERFORM pg_catalog.set_config('cafe_elite.original_orders_digest', coalesce(before_digest,''), true);
END;
$preflight$;

CREATE SEQUENCE public.cafe_elite_order_number_seq AS integer
  START WITH 10000 INCREMENT BY 1 MINVALUE 10000 MAXVALUE 99999 NO CYCLE CACHE 1;

ALTER TABLE public.cafe_elite_orders ADD COLUMN order_number integer;

-- Deterministic backfill: old orders keep original IDs/status/notes/payments.
WITH numbered AS (
  SELECT id, (9999 + row_number() OVER (ORDER BY created_at,id))::integer AS new_number
  FROM public.cafe_elite_orders
)
UPDATE public.cafe_elite_orders orders
  SET order_number = numbered.new_number
  FROM numbered WHERE orders.id = numbered.id;

-- The very next insert receives the next unused 5-digit number.
SELECT pg_catalog.setval('public.cafe_elite_order_number_seq'::regclass,
  greatest(10000, 9999 + (SELECT count(*) FROM public.cafe_elite_orders)),
  (SELECT count(*) FROM public.cafe_elite_orders) > 0);

ALTER TABLE public.cafe_elite_orders
  ALTER COLUMN order_number SET DEFAULT pg_catalog.nextval('public.cafe_elite_order_number_seq'::regclass),
  ALTER COLUMN order_number SET NOT NULL,
  ADD CONSTRAINT cafe_elite_orders_order_number_valid CHECK (order_number BETWEEN 10000 AND 99999),
  ADD CONSTRAINT cafe_elite_orders_order_number_unique UNIQUE (order_number);

ALTER SEQUENCE public.cafe_elite_order_number_seq OWNED BY public.cafe_elite_orders.order_number;
REVOKE ALL ON SEQUENCE public.cafe_elite_order_number_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SEQUENCE public.cafe_elite_order_number_seq TO service_role;

DO $postflight$
DECLARE after_digest text;
BEGIN
  SELECT encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.string_agg((pg_catalog.to_jsonb(o) - 'order_number')::text, E'\n' ORDER BY o.id),'UTF8')),'hex')
    INTO after_digest FROM public.cafe_elite_orders o;
  IF coalesce(after_digest,'') IS DISTINCT FROM current_setting('cafe_elite.original_orders_digest')
    OR (SELECT count(*) FROM public.cafe_elite_orders) <> __EXPECTED_ORDER_COUNT__
    OR EXISTS (SELECT 1 FROM public.cafe_elite_orders WHERE order_number IS NULL)
    OR (SELECT count(DISTINCT order_number) FROM public.cafe_elite_orders) <> __EXPECTED_ORDER_COUNT__
    OR NOT pg_catalog.has_sequence_privilege('service_role','public.cafe_elite_order_number_seq','USAGE')
    OR pg_catalog.has_sequence_privilege('anon','public.cafe_elite_order_number_seq','USAGE')
    OR pg_catalog.has_sequence_privilege('authenticated','public.cafe_elite_order_number_seq','USAGE') THEN
    RAISE EXCEPTION 'Five-digit reference preservation or privilege postcheck failed';
  END IF;
END;
$postflight$;
COMMIT;
