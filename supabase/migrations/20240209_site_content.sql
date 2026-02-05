-- Create site_content table
create table if not exists public.site_content (
  id uuid default gen_random_uuid() primary key,
  key text not null unique,
  content text not null,
  label text,
  category text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable RLS
alter table public.site_content enable row level security;

-- Policies
drop policy if exists "Allow public read access" on public.site_content;
create policy "Allow public read access"
  on public.site_content for select
  using (true);

drop policy if exists "Allow admin write access" on public.site_content;
create policy "Allow admin write access"
  on public.site_content for all
  using (auth.role() = 'service_role');

-- Insert initial data
insert into public.site_content (key, content, label, category) values
('contact_address_line1', '(Privacy)', 'Address Line 1', 'contact'),
('contact_address_line2', 'No.9 Yulin Road, Hangzhou', 'Address Line 2', 'contact'),
('contact_email_primary', 'ljl.leo7@gmail.com', 'Primary Email', 'contact'),
('contact_email_support', 'N/A', 'Support Email', 'contact'),
('contact_email_full', '(Privacy)', 'Full Email Address', 'contact'),
('contact_phone_main', '(Privacy)', 'Main Phone', 'contact'),
('contact_hours', 'Mon-Sun, 9am-9pm UTC+8', 'Business Hours', 'contact'),
('social_github', 'https://github.com/ljlleo7-prog', 'GitHub URL', 'social'),
('social_twitter', 'N/A', 'Twitter URL', 'social'),
('social_linkedin', 'N/A', 'LinkedIn URL', 'social')
on conflict (key) do nothing;
