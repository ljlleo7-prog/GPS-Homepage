-- 1. TICKET TYPES (Assets)
CREATE TABLE IF NOT EXISTS public.ticket_types (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  total_supply INTEGER, -- Optional cap
  creator_id UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. USER TICKET BALANCES
CREATE TABLE IF NOT EXISTS public.user_ticket_balances (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  ticket_type_id UUID REFERENCES public.ticket_types(id) ON DELETE CASCADE NOT NULL,
  balance INTEGER DEFAULT 0 CHECK (balance >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, ticket_type_id)
);

-- 3. TICKET LISTINGS (Marketplace)
CREATE TABLE IF NOT EXISTS public.ticket_listings (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  seller_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  ticket_type_id UUID REFERENCES public.ticket_types(id) ON DELETE CASCADE NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price_per_unit NUMERIC(20, 2) NOT NULL CHECK (price_per_unit >= 0),
  status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SOLD', 'CANCELLED')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. TICKET TRANSACTIONS (History)
CREATE TABLE IF NOT EXISTS public.ticket_transactions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  listing_id UUID REFERENCES public.ticket_listings(id),
  buyer_id UUID REFERENCES public.profiles(id) NOT NULL,
  seller_id UUID REFERENCES public.profiles(id) NOT NULL,
  ticket_type_id UUID REFERENCES public.ticket_types(id) NOT NULL,
  quantity INTEGER NOT NULL,
  price_per_unit NUMERIC(20, 2) NOT NULL,
  total_price NUMERIC(20, 2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS POLICIES
ALTER TABLE public.ticket_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_ticket_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_transactions ENABLE ROW LEVEL SECURITY;

-- Ticket Types: Public read
CREATE POLICY "Ticket types are viewable by everyone" ON public.ticket_types FOR SELECT USING (true);

-- User Ticket Balances: View own
CREATE POLICY "Users can view own ticket balances" ON public.user_ticket_balances FOR SELECT USING (auth.uid() = user_id);

-- Ticket Listings: View all active, View own all
CREATE POLICY "Anyone can view active listings" ON public.ticket_listings FOR SELECT USING (status = 'ACTIVE' OR auth.uid() = seller_id);
-- Insert via function/client (if allowed, but we prefer function for locking). 
-- Actually, listing creation should lock tokens/assets. So maybe function only?
-- Let's allow SELECT. Insert/Update via Service Role (Edge Function) to ensure asset locking.
-- But wait, if I use Edge Function for everything, I can disable Insert/Update RLS for authenticated users.

-- Ticket Transactions: View involved
CREATE POLICY "Users can view their own transactions" ON public.ticket_transactions FOR SELECT USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

-- SEED DATA
INSERT INTO public.ticket_types (title, description, total_supply) VALUES
('Piastri Win - Monaco 2024', 'Pays out if Oscar Piastri wins the 2024 Monaco Grand Prix', 1000),
('Norris Podium - Silverstone', 'Pays out if Lando Norris finishes Top 3 at Silverstone', 1000),
('Ferrari Constructors Champ', 'Pays out if Ferrari wins 2025 Constructors', 500);
