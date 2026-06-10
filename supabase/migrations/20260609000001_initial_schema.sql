-- =============================================================
-- RestroSewa — Initial Schema
-- Milestone 2: Database + RLS + Custom Access Token Hook
-- =============================================================

-- ─── Extensions ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Utility: auto-update updated_at ──────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- =============================================================
-- 1. PERMISSION TEMPLATES (platform-wide, Super Admin only)
-- =============================================================
CREATE TABLE public.permission_templates (
  id          uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text      NOT NULL,
  permissions text[]    NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_permission_templates_updated_at
  BEFORE UPDATE ON public.permission_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================
-- 2. RESTAURANTS
-- =============================================================
CREATE TABLE public.restaurants (
  id           uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text      NOT NULL,
  slug         text      UNIQUE NOT NULL,
  phone        text,
  email        text,
  address      text,
  logo_url     text,
  status       text      NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'suspended', 'archived')),
  capabilities text[]    NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_restaurants_updated_at
  BEFORE UPDATE ON public.restaurants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================
-- 3. RESTAURANT SETTINGS (1:1 with restaurant)
-- =============================================================
CREATE TABLE public.restaurant_settings (
  id                              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id                   uuid    UNIQUE NOT NULL REFERENCES public.restaurants(id),
  cleaning_required               boolean NOT NULL DEFAULT false,
  default_service_charge_percent  integer NOT NULL DEFAULT 0
                                  CHECK (default_service_charge_percent BETWEEN 0 AND 100),
  sound_notifications_enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_restaurant_settings_updated_at
  BEFORE UPDATE ON public.restaurant_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================
-- 4. RESTAURANT USERS
-- =============================================================
CREATE TABLE public.restaurant_users (
  id                     uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id          uuid    NOT NULL REFERENCES public.restaurants(id),
  auth_user_id           uuid    UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_id            text    NOT NULL,
  name                   text    NOT NULL,
  display_title          text    NOT NULL DEFAULT '',
  role                   text    NOT NULL DEFAULT 'restaurant_employee'
                                 CHECK (role IN ('restaurant_admin', 'restaurant_employee')),
  permission_template_id uuid    REFERENCES public.permission_templates(id),
  is_active              boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- Employee ID unique within each restaurant
  UNIQUE (restaurant_id, employee_id)
);

CREATE TRIGGER set_restaurant_users_updated_at
  BEFORE UPDATE ON public.restaurant_users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_restaurant_users_restaurant_id ON public.restaurant_users (restaurant_id);
CREATE INDEX idx_restaurant_users_auth_user_id  ON public.restaurant_users (auth_user_id);


-- =============================================================
-- 5. TABLE GROUPS
-- =============================================================
CREATE TABLE public.table_groups (
  id            uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid  NOT NULL REFERENCES public.restaurants(id),
  name          text  NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_table_groups_restaurant_id ON public.table_groups (restaurant_id);


-- =============================================================
-- 6. RESTAURANT TABLES
-- =============================================================
CREATE TABLE public.restaurant_tables (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   uuid    NOT NULL REFERENCES public.restaurants(id),
  table_group_id  uuid    REFERENCES public.table_groups(id),
  display_name    text    NOT NULL,
  qr_token        uuid    UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  status          text    NOT NULL DEFAULT 'available'
                          CHECK (status IN ('available', 'waiting_activation', 'occupied', 'cleaning')),
  assigned_user_id uuid   REFERENCES public.restaurant_users(id),
  position        integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_restaurant_tables_updated_at
  BEFORE UPDATE ON public.restaurant_tables
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_restaurant_tables_restaurant_id ON public.restaurant_tables (restaurant_id);
CREATE INDEX idx_restaurant_tables_qr_token      ON public.restaurant_tables (qr_token);


-- =============================================================
-- 7. SESSIONS
-- =============================================================
CREATE TABLE public.sessions (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   uuid    NOT NULL REFERENCES public.restaurants(id),
  table_id        uuid    NOT NULL REFERENCES public.restaurant_tables(id),
  activated_by    uuid    REFERENCES public.restaurant_users(id),
  status          text    NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'completed')),
  bill_requested  boolean NOT NULL DEFAULT false,
  ordering_locked boolean NOT NULL DEFAULT false,
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);

-- Business rule: at most one active session per table
CREATE UNIQUE INDEX sessions_one_active_per_table
  ON public.sessions (table_id)
  WHERE status = 'active';

CREATE INDEX idx_sessions_table_id      ON public.sessions (table_id);
CREATE INDEX idx_sessions_restaurant_id ON public.sessions (restaurant_id);
CREATE INDEX idx_sessions_status        ON public.sessions (status);


-- =============================================================
-- 8. MENU CATEGORIES
-- =============================================================
CREATE TABLE public.menu_categories (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid    NOT NULL REFERENCES public.restaurants(id),
  name          text    NOT NULL,
  description   text,
  image_url     text,
  sort_order    integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_menu_categories_updated_at
  BEFORE UPDATE ON public.menu_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_menu_categories_restaurant_id ON public.menu_categories (restaurant_id);


-- =============================================================
-- 9. MENU ITEMS
-- =============================================================
CREATE TABLE public.menu_items (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid    NOT NULL REFERENCES public.restaurants(id),
  category_id   uuid    REFERENCES public.menu_categories(id) ON DELETE SET NULL,
  name          text    NOT NULL,
  description   text,
  base_price    integer NOT NULL DEFAULT 0 CHECK (base_price >= 0),
  image_url     text,
  status        text    NOT NULL DEFAULT 'available'
                        CHECK (status IN ('available', 'out_of_stock', 'hidden')),
  is_special    boolean NOT NULL DEFAULT false,
  is_veg        boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_menu_items_updated_at
  BEFORE UPDATE ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_menu_items_restaurant_id ON public.menu_items (restaurant_id);
CREATE INDEX idx_menu_items_category_id   ON public.menu_items (category_id);
CREATE INDEX idx_menu_items_status        ON public.menu_items (status);


-- =============================================================
-- 10. VARIANTS
-- =============================================================
CREATE TABLE public.variants (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id    uuid    NOT NULL REFERENCES public.restaurants(id),
  menu_item_id     uuid    NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  name             text    NOT NULL,
  additional_price integer NOT NULL DEFAULT 0 CHECK (additional_price >= 0),
  is_active        boolean NOT NULL DEFAULT true,
  sort_order       integer NOT NULL DEFAULT 0
);

CREATE INDEX idx_variants_menu_item_id ON public.variants (menu_item_id);


-- =============================================================
-- 11. ADDONS
-- =============================================================
CREATE TABLE public.addons (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id    uuid    NOT NULL REFERENCES public.restaurants(id),
  menu_item_id     uuid    NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  name             text    NOT NULL,
  additional_price integer NOT NULL DEFAULT 0 CHECK (additional_price >= 0),
  is_active        boolean NOT NULL DEFAULT true
);

CREATE INDEX idx_addons_menu_item_id ON public.addons (menu_item_id);


-- =============================================================
-- 12. SESSION ORDERS
-- =============================================================
CREATE TABLE public.session_orders (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id    uuid    NOT NULL REFERENCES public.restaurants(id),
  session_id       uuid    NOT NULL REFERENCES public.sessions(id),
  status           text    NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','accepted','preparing','ready','served','cancelled','rejected')),
  notes            text,
  total_amount     integer NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  accepted_by      uuid    REFERENCES public.restaurant_users(id),
  accepted_at      timestamptz,
  rejected_by      uuid    REFERENCES public.restaurant_users(id),
  rejected_at      timestamptz,
  rejection_reason text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_session_orders_updated_at
  BEFORE UPDATE ON public.session_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_session_orders_session_id    ON public.session_orders (session_id);
CREATE INDEX idx_session_orders_restaurant_id ON public.session_orders (restaurant_id);
CREATE INDEX idx_session_orders_status        ON public.session_orders (status);


-- =============================================================
-- 13. SESSION ORDER ITEMS
-- Price is frozen at Order submission time (snapshot columns).
-- =============================================================
CREATE TABLE public.session_order_items (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid    NOT NULL REFERENCES public.session_orders(id),
  restaurant_id    uuid    NOT NULL REFERENCES public.restaurants(id),
  menu_item_id     uuid    REFERENCES public.menu_items(id) ON DELETE SET NULL,
  menu_item_name   text    NOT NULL,
  variant_id       uuid    REFERENCES public.variants(id) ON DELETE SET NULL,
  variant_name     text,
  unit_price       integer NOT NULL CHECK (unit_price >= 0),
  quantity         integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  addons_snapshot  jsonb   NOT NULL DEFAULT '[]',
  notes            text,
  serving_status   text    NOT NULL DEFAULT 'pending'
                           CHECK (serving_status IN ('pending', 'served'))
);

CREATE INDEX idx_session_order_items_order_id ON public.session_order_items (order_id);


-- =============================================================
-- 14. SESSION PAYMENTS (immutable after creation)
-- =============================================================
CREATE TABLE public.session_payments (
  id             uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  uuid    NOT NULL REFERENCES public.restaurants(id),
  session_id     uuid    NOT NULL REFERENCES public.sessions(id),
  payment_method text    NOT NULL CHECK (payment_method IN ('cash', 'online', 'outstanding')),
  amount         integer NOT NULL CHECK (amount > 0),
  reference      text,
  processed_by   uuid    NOT NULL REFERENCES public.restaurant_users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_session_payments_session_id    ON public.session_payments (session_id);
CREATE INDEX idx_session_payments_restaurant_id ON public.session_payments (restaurant_id);


-- =============================================================
-- 15. DISCOUNTS (one per session in V1)
-- =============================================================
CREATE TABLE public.discounts (
  id             uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  uuid    NOT NULL REFERENCES public.restaurants(id),
  session_id     uuid    UNIQUE NOT NULL REFERENCES public.sessions(id),
  discount_type  text    NOT NULL CHECK (discount_type IN ('fixed', 'percentage')),
  -- fixed: value in paise  |  percentage: whole number 1–100
  value          integer NOT NULL CHECK (value > 0),
  applied_by     uuid    NOT NULL REFERENCES public.restaurant_users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);


-- =============================================================
-- 16. ADDITIONAL CHARGES
-- =============================================================
CREATE TABLE public.additional_charges (
  id             uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  uuid    NOT NULL REFERENCES public.restaurants(id),
  session_id     uuid    NOT NULL REFERENCES public.sessions(id),
  name           text    NOT NULL,
  amount         integer NOT NULL CHECK (amount > 0),
  charge_type    text    NOT NULL DEFAULT 'fixed' CHECK (charge_type IN ('fixed', 'percentage')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_additional_charges_session_id ON public.additional_charges (session_id);


-- =============================================================
-- 17. NOTIFICATIONS
-- =============================================================
CREATE TABLE public.notifications (
  id             uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  uuid    NOT NULL REFERENCES public.restaurants(id),
  type           text    NOT NULL CHECK (type IN (
    'new_arrival', 'new_order', 'help_request', 'bill_request',
    'out_of_stock', 'payment_completed', 'outstanding_payment',
    'order_accepted', 'order_ready', 'order_rejected'
  )),
  status         text    NOT NULL DEFAULT 'unread'
                         CHECK (status IN ('unread', 'read', 'dismissed')),
  session_id     uuid    REFERENCES public.sessions(id),
  order_id       uuid    REFERENCES public.session_orders(id),
  table_id       uuid    REFERENCES public.restaurant_tables(id),
  triggered_by   uuid    REFERENCES public.restaurant_users(id),
  read_by        uuid    REFERENCES public.restaurant_users(id),
  message        text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_notifications_updated_at
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_notifications_restaurant_id ON public.notifications (restaurant_id);
CREATE INDEX idx_notifications_status        ON public.notifications (status);
CREATE INDEX idx_notifications_created_at    ON public.notifications (created_at DESC);


-- =============================================================
-- 18. HELP REQUESTS
-- =============================================================
CREATE TABLE public.help_requests (
  id             uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  uuid  NOT NULL REFERENCES public.restaurants(id),
  session_id     uuid  NOT NULL REFERENCES public.sessions(id),
  status         text  NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'claimed', 'resolved')),
  claimed_by     uuid  REFERENCES public.restaurant_users(id),
  resolved_by    uuid  REFERENCES public.restaurant_users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_help_requests_updated_at
  BEFORE UPDATE ON public.help_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_help_requests_session_id ON public.help_requests (session_id);


-- =============================================================
-- 19. BILL REQUESTS
-- =============================================================
CREATE TABLE public.bill_requests (
  id               uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id    uuid  NOT NULL REFERENCES public.restaurants(id),
  session_id       uuid  NOT NULL REFERENCES public.sessions(id),
  status           text  NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'acknowledged', 'cancelled')),
  acknowledged_by  uuid  REFERENCES public.restaurant_users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_bill_requests_updated_at
  BEFORE UPDATE ON public.bill_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- One active bill request per session
CREATE UNIQUE INDEX bill_requests_one_active_per_session
  ON public.bill_requests (session_id)
  WHERE status = 'pending';


-- =============================================================
-- 20. ACTIVITY LOGS (append-only audit trail)
-- =============================================================
CREATE TABLE public.activity_logs (
  id             uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  uuid  NOT NULL REFERENCES public.restaurants(id),
  action         text  NOT NULL,
  performed_by   uuid  REFERENCES public.restaurant_users(id),
  session_id     uuid  REFERENCES public.sessions(id),
  order_id       uuid  REFERENCES public.session_orders(id),
  payment_id     uuid  REFERENCES public.session_payments(id),
  metadata       jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_activity_logs_restaurant_id ON public.activity_logs (restaurant_id);
CREATE INDEX idx_activity_logs_created_at    ON public.activity_logs (created_at DESC);


-- =============================================================
-- CUSTOM ACCESS TOKEN HOOK
-- Enriches JWT with: restaurant_id, role, permissions, restaurant_user_id
-- Register in: Supabase Dashboard → Authentication → Hooks →
--   "Customize Access Token" → pg-functions://postgres/public/custom_access_token_hook
-- =============================================================
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claims       jsonb;
  v_user_id      uuid;
  v_ru           record;
BEGIN
  v_claims  := event -> 'claims';
  v_user_id := (event ->> 'user_id')::uuid;

  SELECT
    ru.id                                      AS restaurant_user_id,
    ru.restaurant_id,
    ru.role,
    COALESCE(pt.permissions, '{}'::text[])     AS permissions
  INTO v_ru
  FROM public.restaurant_users ru
  LEFT JOIN public.permission_templates pt ON pt.id = ru.permission_template_id
  WHERE ru.auth_user_id = v_user_id
    AND ru.is_active = true
  LIMIT 1;

  IF FOUND THEN
    v_claims := jsonb_set(v_claims, '{restaurant_id}',      to_jsonb(v_ru.restaurant_id::text));
    v_claims := jsonb_set(v_claims, '{role}',               to_jsonb(v_ru.role));
    v_claims := jsonb_set(v_claims, '{permissions}',        to_jsonb(v_ru.permissions));
    v_claims := jsonb_set(v_claims, '{restaurant_user_id}', to_jsonb(v_ru.restaurant_user_id::text));
  ELSE
    -- Super Admin is flagged via app_metadata in Supabase Auth
    IF (event -> 'raw_app_meta_data' ->> 'role') = 'super_admin' THEN
      v_claims := jsonb_set(v_claims, '{role}', '"super_admin"');
    END IF;
  END IF;

  RETURN jsonb_set(event, '{claims}', v_claims);
END;
$$;

-- Allow Supabase Auth to invoke the hook; deny direct caller access
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;


-- =============================================================
-- ROW LEVEL SECURITY
-- Pattern: JWT claims drive tenant isolation.
--   auth.jwt() ->> 'role'            → role string
--   (auth.jwt() ->> 'restaurant_id')::uuid → tenant
--
-- Customer (anon) access is handled entirely server-side via
-- service-role Server Actions — no anon RLS policies needed.
-- =============================================================

-- ─── permission_templates ────────────────────────────────────
ALTER TABLE public.permission_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.permission_templates
  FOR ALL TO authenticated
  USING  (auth.jwt() ->> 'role' = 'super_admin')
  WITH CHECK (auth.jwt() ->> 'role' = 'super_admin');

CREATE POLICY "restaurant_users_read" ON public.permission_templates
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' IN ('restaurant_admin', 'restaurant_employee'));

-- ─── restaurants ────────────────────────────────────────────
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.restaurants
  FOR ALL TO authenticated
  USING  (auth.jwt() ->> 'role' = 'super_admin')
  WITH CHECK (auth.jwt() ->> 'role' = 'super_admin');

CREATE POLICY "staff_read_own" ON public.restaurants
  FOR SELECT TO authenticated
  USING (
    id = (auth.jwt() ->> 'restaurant_id')::uuid
    AND auth.jwt() ->> 'role' IN ('restaurant_admin', 'restaurant_employee')
  );

-- ─── restaurant_settings ────────────────────────────────────
ALTER TABLE public.restaurant_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.restaurant_settings
  FOR ALL TO authenticated
  USING  (auth.jwt() ->> 'role' = 'super_admin')
  WITH CHECK (auth.jwt() ->> 'role' = 'super_admin');

CREATE POLICY "admin_manage_own" ON public.restaurant_settings
  FOR ALL TO authenticated
  USING  (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_admin')
  WITH CHECK (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_admin');

CREATE POLICY "employee_read_own" ON public.restaurant_settings
  FOR SELECT TO authenticated
  USING (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_employee');

-- ─── restaurant_users ────────────────────────────────────────
ALTER TABLE public.restaurant_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.restaurant_users
  FOR ALL TO authenticated
  USING  (auth.jwt() ->> 'role' = 'super_admin')
  WITH CHECK (auth.jwt() ->> 'role' = 'super_admin');

CREATE POLICY "admin_read_own_restaurant" ON public.restaurant_users
  FOR SELECT TO authenticated
  USING (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_admin');

CREATE POLICY "read_self" ON public.restaurant_users
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

-- ─── table_groups ────────────────────────────────────────────
ALTER TABLE public.table_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.table_groups
  FOR ALL TO authenticated
  USING  (auth.jwt() ->> 'role' = 'super_admin')
  WITH CHECK (auth.jwt() ->> 'role' = 'super_admin');

CREATE POLICY "admin_manage_own" ON public.table_groups
  FOR ALL TO authenticated
  USING  (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_admin')
  WITH CHECK (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_admin');

CREATE POLICY "employee_read_own" ON public.table_groups
  FOR SELECT TO authenticated
  USING (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_employee');

-- ─── restaurant_tables ───────────────────────────────────────
ALTER TABLE public.restaurant_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.restaurant_tables
  FOR ALL TO authenticated
  USING  (auth.jwt() ->> 'role' = 'super_admin')
  WITH CHECK (auth.jwt() ->> 'role' = 'super_admin');

CREATE POLICY "admin_manage_own" ON public.restaurant_tables
  FOR ALL TO authenticated
  USING  (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_admin')
  WITH CHECK (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_admin');

CREATE POLICY "employee_read_update_own" ON public.restaurant_tables
  FOR SELECT TO authenticated
  USING (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_employee');

CREATE POLICY "employee_update_status" ON public.restaurant_tables
  FOR UPDATE TO authenticated
  USING  (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_employee')
  WITH CHECK (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_employee');

-- ─── sessions ────────────────────────────────────────────────
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.sessions
  FOR ALL TO authenticated
  USING  (auth.jwt() ->> 'role' = 'super_admin')
  WITH CHECK (auth.jwt() ->> 'role' = 'super_admin');

CREATE POLICY "staff_all_own" ON public.sessions
  FOR ALL TO authenticated
  USING  (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' IN ('restaurant_admin','restaurant_employee'))
  WITH CHECK (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' IN ('restaurant_admin','restaurant_employee'));

-- ─── menu_categories ─────────────────────────────────────────
ALTER TABLE public.menu_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.menu_categories
  FOR ALL TO authenticated
  USING  (auth.jwt() ->> 'role' = 'super_admin')
  WITH CHECK (auth.jwt() ->> 'role' = 'super_admin');

CREATE POLICY "admin_manage_own" ON public.menu_categories
  FOR ALL TO authenticated
  USING  (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_admin')
  WITH CHECK (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_admin');

CREATE POLICY "employee_read_own" ON public.menu_categories
  FOR SELECT TO authenticated
  USING (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_employee');

-- ─── menu_items ──────────────────────────────────────────────
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.menu_items
  FOR ALL TO authenticated
  USING  (auth.jwt() ->> 'role' = 'super_admin')
  WITH CHECK (auth.jwt() ->> 'role' = 'super_admin');

CREATE POLICY "admin_manage_own" ON public.menu_items
  FOR ALL TO authenticated
  USING  (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_admin')
  WITH CHECK (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_admin');

CREATE POLICY "employee_read_own" ON public.menu_items
  FOR SELECT TO authenticated
  USING (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_employee');

CREATE POLICY "employee_update_stock" ON public.menu_items
  FOR UPDATE TO authenticated
  USING  (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_employee')
  WITH CHECK (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_employee');

-- ─── variants ────────────────────────────────────────────────
ALTER TABLE public.variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.variants
  FOR ALL TO authenticated
  USING  (auth.jwt() ->> 'role' = 'super_admin')
  WITH CHECK (auth.jwt() ->> 'role' = 'super_admin');

CREATE POLICY "admin_manage_own" ON public.variants
  FOR ALL TO authenticated
  USING  (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_admin')
  WITH CHECK (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_admin');

CREATE POLICY "employee_read_own" ON public.variants
  FOR SELECT TO authenticated
  USING (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_employee');

-- ─── addons ──────────────────────────────────────────────────
ALTER TABLE public.addons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.addons
  FOR ALL TO authenticated
  USING  (auth.jwt() ->> 'role' = 'super_admin')
  WITH CHECK (auth.jwt() ->> 'role' = 'super_admin');

CREATE POLICY "admin_manage_own" ON public.addons
  FOR ALL TO authenticated
  USING  (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_admin')
  WITH CHECK (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_admin');

CREATE POLICY "employee_read_own" ON public.addons
  FOR SELECT TO authenticated
  USING (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_employee');

-- ─── session_orders ──────────────────────────────────────────
ALTER TABLE public.session_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.session_orders
  FOR ALL TO authenticated
  USING  (auth.jwt() ->> 'role' = 'super_admin')
  WITH CHECK (auth.jwt() ->> 'role' = 'super_admin');

CREATE POLICY "staff_all_own" ON public.session_orders
  FOR ALL TO authenticated
  USING  (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' IN ('restaurant_admin','restaurant_employee'))
  WITH CHECK (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' IN ('restaurant_admin','restaurant_employee'));

-- ─── session_order_items ─────────────────────────────────────
ALTER TABLE public.session_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.session_order_items
  FOR ALL TO authenticated
  USING  (auth.jwt() ->> 'role' = 'super_admin')
  WITH CHECK (auth.jwt() ->> 'role' = 'super_admin');

CREATE POLICY "staff_all_own" ON public.session_order_items
  FOR ALL TO authenticated
  USING  (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' IN ('restaurant_admin','restaurant_employee'))
  WITH CHECK (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' IN ('restaurant_admin','restaurant_employee'));

-- ─── session_payments ────────────────────────────────────────
ALTER TABLE public.session_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.session_payments
  FOR ALL TO authenticated
  USING  (auth.jwt() ->> 'role' = 'super_admin')
  WITH CHECK (auth.jwt() ->> 'role' = 'super_admin');

CREATE POLICY "staff_all_own" ON public.session_payments
  FOR ALL TO authenticated
  USING  (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' IN ('restaurant_admin','restaurant_employee'))
  WITH CHECK (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' IN ('restaurant_admin','restaurant_employee'));

-- ─── discounts ───────────────────────────────────────────────
ALTER TABLE public.discounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.discounts
  FOR ALL TO authenticated
  USING  (auth.jwt() ->> 'role' = 'super_admin')
  WITH CHECK (auth.jwt() ->> 'role' = 'super_admin');

CREATE POLICY "staff_all_own" ON public.discounts
  FOR ALL TO authenticated
  USING  (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' IN ('restaurant_admin','restaurant_employee'))
  WITH CHECK (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' IN ('restaurant_admin','restaurant_employee'));

-- ─── additional_charges ──────────────────────────────────────
ALTER TABLE public.additional_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.additional_charges
  FOR ALL TO authenticated
  USING  (auth.jwt() ->> 'role' = 'super_admin')
  WITH CHECK (auth.jwt() ->> 'role' = 'super_admin');

CREATE POLICY "staff_all_own" ON public.additional_charges
  FOR ALL TO authenticated
  USING  (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' IN ('restaurant_admin','restaurant_employee'))
  WITH CHECK (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' IN ('restaurant_admin','restaurant_employee'));

-- ─── notifications ───────────────────────────────────────────
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.notifications
  FOR ALL TO authenticated
  USING  (auth.jwt() ->> 'role' = 'super_admin')
  WITH CHECK (auth.jwt() ->> 'role' = 'super_admin');

CREATE POLICY "staff_all_own" ON public.notifications
  FOR ALL TO authenticated
  USING  (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' IN ('restaurant_admin','restaurant_employee'))
  WITH CHECK (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' IN ('restaurant_admin','restaurant_employee'));

-- ─── help_requests ───────────────────────────────────────────
ALTER TABLE public.help_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.help_requests
  FOR ALL TO authenticated
  USING  (auth.jwt() ->> 'role' = 'super_admin')
  WITH CHECK (auth.jwt() ->> 'role' = 'super_admin');

CREATE POLICY "staff_all_own" ON public.help_requests
  FOR ALL TO authenticated
  USING  (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' IN ('restaurant_admin','restaurant_employee'))
  WITH CHECK (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' IN ('restaurant_admin','restaurant_employee'));

-- ─── bill_requests ───────────────────────────────────────────
ALTER TABLE public.bill_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.bill_requests
  FOR ALL TO authenticated
  USING  (auth.jwt() ->> 'role' = 'super_admin')
  WITH CHECK (auth.jwt() ->> 'role' = 'super_admin');

CREATE POLICY "staff_all_own" ON public.bill_requests
  FOR ALL TO authenticated
  USING  (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' IN ('restaurant_admin','restaurant_employee'))
  WITH CHECK (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' IN ('restaurant_admin','restaurant_employee'));

-- ─── activity_logs ───────────────────────────────────────────
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.activity_logs
  FOR ALL TO authenticated
  USING  (auth.jwt() ->> 'role' = 'super_admin')
  WITH CHECK (auth.jwt() ->> 'role' = 'super_admin');

CREATE POLICY "admin_read_own" ON public.activity_logs
  FOR SELECT TO authenticated
  USING (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' = 'restaurant_admin');

CREATE POLICY "staff_insert_own" ON public.activity_logs
  FOR INSERT TO authenticated
  WITH CHECK (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid AND auth.jwt() ->> 'role' IN ('restaurant_admin','restaurant_employee'));
