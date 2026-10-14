-- Dedicated schema: this migration does not modify other applications' tables or Supabase Auth.
BEGIN;
CREATE SCHEMA IF NOT EXISTS shigodeki;
REVOKE ALL ON SCHEMA shigodeki FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA shigodeki TO service_role;
CREATE TABLE IF NOT EXISTS shigodeki.users (
  id uuid PRIMARY KEY, email text NOT NULL UNIQUE, password text NOT NULL,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS shigodeki.licenses (
  token text PRIMARY KEY, email text NOT NULL, expires bigint NOT NULL, used bigint
);
CREATE TABLE IF NOT EXISTS shigodeki.sessions (
  token text PRIMARY KEY, user_id uuid NOT NULL UNIQUE REFERENCES shigodeki.users(id), expires bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS shigodeki.notebooks (
  user_id uuid PRIMARY KEY REFERENCES shigodeki.users(id), revision integer NOT NULL CHECK(revision>0), document jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS shigodeki.attempts (key text PRIMARY KEY, count integer NOT NULL, reset_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS shigodeki.quotes (token text PRIMARY KEY, coupon_hash text NOT NULL, expires bigint NOT NULL, used bigint);
CREATE TABLE IF NOT EXISTS shigodeki.orders (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES shigodeki.users(id),
  currency text NOT NULL CHECK(currency='JPY'), list_price integer NOT NULL CHECK(list_price=980),
  coupon_discount integer NOT NULL CHECK(coupon_discount=50000), applied_discount integer NOT NULL CHECK(applied_discount=980),
  total integer NOT NULL CHECK(total=0), created_at bigint NOT NULL
);
ALTER TABLE shigodeki.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE shigodeki.licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE shigodeki.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE shigodeki.notebooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE shigodeki.attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shigodeki.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE shigodeki.orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA shigodeki FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA shigodeki TO service_role;

-- Only Netlify's secret service-role connection may execute this function.
-- SECURITY INVOKER deliberately avoids granting elevated rights to public callers.
CREATE OR REPLACE FUNCTION public.shigodeki_rpc(p_action text, p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, shigodeki AS $$
DECLARE
  now_ms bigint := floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
  u shigodeki.users%ROWTYPE;
  q shigodeki.quotes%ROWTYPE;
  l shigodeki.licenses%ROWTYPE;
  note shigodeki.notebooks%ROWTYPE;
  uid uuid;
  count_value integer;
  order_value jsonb;
BEGIN
  IF p_action='health' THEN RETURN jsonb_build_object('ok',true); END IF;
  IF p_action='throttle' THEN
    DELETE FROM shigodeki.attempts WHERE reset_at<now_ms;
    INSERT INTO shigodeki.attempts(key,count,reset_at) VALUES(p_data->>'key',1,now_ms+900000)
      ON CONFLICT(key) DO UPDATE SET count=shigodeki.attempts.count+1 RETURNING count INTO count_value;
    IF count_value>(p_data->>'limit')::integer THEN
      RETURN jsonb_build_object('status',429,'error','試行回数が多いため、15分後に再度お試しください。');
    END IF;
    RETURN '{}'::jsonb;
  END IF;
  IF p_action='get-user' THEN
    SELECT * INTO u FROM shigodeki.users WHERE email=p_data->>'email' AND active;
    RETURN jsonb_build_object('user', CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('id',u.id,'email',u.email,'password',u.password) END);
  END IF;
  IF p_action='quote' THEN
    DELETE FROM shigodeki.quotes WHERE expires<now_ms;
    INSERT INTO shigodeki.quotes(token,coupon_hash,expires) VALUES(p_data->>'token',p_data->>'coupon_hash',now_ms+900000);
    RETURN jsonb_build_object('expires',now_ms+900000);
  END IF;
  IF p_action='issue-license' THEN
    INSERT INTO shigodeki.licenses(token,email,expires) VALUES(p_data->>'token',p_data->>'email',now_ms+2592000000);
    RETURN jsonb_build_object('ok',true);
  END IF;
  IF p_action IN ('revoke','restore') THEN
    UPDATE shigodeki.users SET active=(p_action='restore') WHERE email=p_data->>'email' RETURNING id INTO uid;
    IF p_action='revoke' THEN
      DELETE FROM shigodeki.sessions WHERE user_id=uid;
      DELETE FROM shigodeki.licenses WHERE email=p_data->>'email' AND used IS NULL;
    END IF;
    RETURN jsonb_build_object('updated',uid IS NOT NULL);
  END IF;
  IF p_action='free-checkout' THEN
    SELECT * INTO q FROM shigodeki.quotes WHERE token=p_data->>'quote_token' FOR UPDATE;
    IF q.token IS NULL OR q.used IS NOT NULL OR q.expires<=now_ms OR q.coupon_hash<>p_data->>'coupon_hash' THEN
      RETURN jsonb_build_object('status',409,'error','クーポンをもう一度適用してください。有効期限切れ、または取得済みです。');
    END IF;
    IF EXISTS(SELECT 1 FROM shigodeki.users WHERE email=p_data->>'email') THEN
      RETURN jsonb_build_object('status',409,'error','このメールアドレスは登録済みです。アプリのログイン画面から開いてください。');
    END IF;
    uid := (p_data->>'user_id')::uuid;
    INSERT INTO shigodeki.users(id,email,password) VALUES(uid,p_data->>'email',p_data->>'password');
    INSERT INTO shigodeki.orders(id,user_id,currency,list_price,coupon_discount,applied_discount,total,created_at)
      VALUES((p_data->>'order_id')::uuid,uid,'JPY',980,50000,980,0,now_ms);
    UPDATE shigodeki.quotes SET used=now_ms WHERE token=q.token;
  ELSIF p_action='redeem' THEN
    SELECT * INTO l FROM shigodeki.licenses WHERE token=p_data->>'license_token' AND email=p_data->>'email' FOR UPDATE;
    IF l.token IS NULL OR l.used IS NOT NULL OR l.expires<=now_ms THEN
      RETURN jsonb_build_object('status',403,'error','利用コードが無効、使用済み、または購入メールアドレスと一致しません。');
    END IF;
    SELECT * INTO u FROM shigodeki.users WHERE email=p_data->>'email' FOR UPDATE;
    IF u.id IS NOT NULL AND NOT u.active THEN
      RETURN jsonb_build_object('status',403,'error','利用権限が停止されています。販売者にお問い合わせください。');
    END IF;
    uid:=coalesce(u.id,(p_data->>'user_id')::uuid);
    INSERT INTO shigodeki.users(id,email,password) VALUES(uid,p_data->>'email',p_data->>'password')
      ON CONFLICT(id) DO UPDATE SET password=excluded.password;
    UPDATE shigodeki.licenses SET used=now_ms WHERE token=l.token;
  ELSIF p_action='login' THEN
    SELECT * INTO u FROM shigodeki.users WHERE email=p_data->>'email' FOR UPDATE;
    IF u.id IS NULL OR NOT u.active OR u.password<>p_data->>'password' THEN
      RETURN jsonb_build_object('status',401,'error','メールアドレスまたはパスワードが正しくないか、利用権限がありません。');
    END IF;
    uid:=u.id;
  END IF;
  IF p_action IN ('free-checkout','redeem','login') THEN
    DELETE FROM shigodeki.sessions WHERE user_id=uid;
    INSERT INTO shigodeki.sessions(token,user_id,expires) VALUES(p_data->>'session_token',uid,now_ms+604800000);
    RETURN jsonb_build_object('user',jsonb_build_object('id',uid,'email',p_data->>'email'),'expires',now_ms+604800000);
  END IF;

  -- Lock the account during each authenticated operation so revocation, session
  -- replacement and optimistic notebook writes remain atomic across instances.
  SELECT users.* INTO u FROM shigodeki.users users JOIN shigodeki.sessions sessions ON sessions.user_id=users.id
    WHERE sessions.token=p_data->>'session_token' AND sessions.expires>now_ms AND users.active FOR UPDATE OF users;
  now_ms := floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
  IF u.id IS NULL OR NOT EXISTS(SELECT 1 FROM shigodeki.sessions WHERE user_id=u.id AND token=p_data->>'session_token' AND expires>now_ms) THEN
    RETURN jsonb_build_object('status',401,'error','ログインの有効期限が切れたか、別の端末でログインされました。再ログインしてください。');
  END IF;
  IF p_action='session' THEN
    RETURN jsonb_build_object('user',jsonb_build_object('id',u.id,'email',u.email),'expires',(SELECT expires FROM shigodeki.sessions WHERE user_id=u.id));
  ELSIF p_action='access' THEN
    SELECT jsonb_build_object('id',id,'price',list_price,'couponDiscount',coupon_discount,'appliedDiscount',applied_discount,'total',total,'currency',currency)
      INTO order_value FROM shigodeki.orders WHERE user_id=u.id ORDER BY created_at DESC LIMIT 1;
    RETURN jsonb_build_object('user',jsonb_build_object('id',u.id,'email',u.email),'order',order_value,'appPath','/tools/shigodeki-sensei/app/');
  ELSIF p_action='logout' THEN
    DELETE FROM shigodeki.sessions WHERE user_id=u.id;
    RETURN jsonb_build_object('ok',true);
  ELSIF p_action='state-get' THEN
    SELECT * INTO note FROM shigodeki.notebooks WHERE user_id=u.id;
    RETURN jsonb_build_object('revision',coalesce(note.revision,0),'state',note.document);
  ELSIF p_action='state-put' THEN
    SELECT * INTO note FROM shigodeki.notebooks WHERE user_id=u.id;
    IF coalesce(note.revision,0)<>(p_data->>'revision')::integer THEN
      RETURN jsonb_build_object('status',409,'error','別の画面の変更が保存されています。端末のバックアップを保存してから再読込してください。');
    END IF;
    INSERT INTO shigodeki.notebooks(user_id,revision,document) VALUES(u.id,(p_data->>'revision')::integer+1,p_data->'state')
      ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,document=excluded.document;
    RETURN jsonb_build_object('revision',(p_data->>'revision')::integer+1);
  END IF;
  RETURN jsonb_build_object('status',404,'error','この操作は見つかりません。');
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('status',409,'error','登録または取得済みです。ログイン画面から開いてください。');
END;
$$;
REVOKE ALL ON FUNCTION public.shigodeki_rpc(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shigodeki_rpc(text,jsonb) TO service_role;
COMMENT ON FUNCTION public.shigodeki_rpc(text,jsonb) IS 'Shigodeki purchaser API. Server-side service_role only; do not grant to anon/authenticated.';
COMMIT;
