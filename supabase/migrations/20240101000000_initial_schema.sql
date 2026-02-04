-- Create tables
CREATE TABLE IF NOT EXISTS news_articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    excerpt TEXT NOT NULL,
    content TEXT NOT NULL,
    image_url VARCHAR(500),
    category VARCHAR(50) NOT NULL,
    published_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    author VARCHAR(100) NOT NULL,
    featured BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contact_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    subject VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    role VARCHAR(100) NOT NULL,
    bio TEXT NOT NULL,
    photo_url VARCHAR(500),
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_news_published_at ON news_articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_category ON news_articles(category);
CREATE INDEX IF NOT EXISTS idx_news_featured ON news_articles(featured);
CREATE INDEX IF NOT EXISTS idx_contact_created_at ON contact_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_team_display_order ON team_members(display_order);

-- Set up Row Level Security
ALTER TABLE news_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Public can read news articles" ON news_articles
    FOR SELECT USING (true);

CREATE POLICY "Authenticated users can insert contact messages" ON contact_messages
    FOR INSERT WITH CHECK (true);

-- Allow public to insert contact messages (since it's a public form)
CREATE POLICY "Public can insert contact messages" ON contact_messages
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Public can read team members" ON team_members
    FOR SELECT USING (true);

-- Grant permissions
GRANT SELECT ON news_articles TO anon;
GRANT SELECT ON team_members TO anon;
GRANT INSERT ON contact_messages TO anon;
GRANT ALL PRIVILEGES ON news_articles TO authenticated;
GRANT ALL PRIVILEGES ON team_members TO authenticated;
GRANT ALL PRIVILEGES ON contact_messages TO authenticated;

-- Seed initial data for News Articles
INSERT INTO news_articles (title, excerpt, content, category, author, featured, image_url) VALUES
('GeeksProductionStudio Launches New AI Division', 'We are excited to announce the formation of our new AI research and development division.', 'GeeksProductionStudio is proud to unveil its latest venture: a dedicated Artificial Intelligence division. This new team will focus on developing cutting-edge machine learning models and integrating AI solutions into our existing production workflows. We believe that AI is the future of digital content creation, and we are committed to staying at the forefront of this technology.', 'Company News', 'Admin', true, 'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=futuristic%20ai%20lab%20with%20glowing%20screens%20and%20robots%20cyberpunk%20style&image_size=landscape_16_9'),
('The Future of Web Development: Trends to Watch', 'A deep dive into the emerging technologies that are shaping the web.', 'From WebAssembly to Edge Computing, the landscape of web development is evolving rapidly. In this article, we explore the key trends that every developer should be aware of. We discuss the rise of serverless architecture, the importance of accessibility, and the growing dominance of JavaScript frameworks.', 'Technology', 'Tech Lead', false, 'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=futuristic%20web%20development%20holographic%20code%20interface%20cyberpunk&image_size=landscape_16_9'),
('Project Spotlight: CyberCity VR Experience', 'A look behind the scenes of our latest immersive VR project.', 'Our team recently completed work on the CyberCity VR Experience, a fully immersive virtual reality tour of a futuristic metropolis. Using the latest in VR technology, we created a stunningly detailed world that users can explore from the comfort of their own homes. This post details the challenges we faced and the solutions we implemented.', 'Projects', 'Creative Director', true, 'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=cyberpunk%20city%20vr%20experience%20neon%20lights%20immersive&image_size=landscape_16_9');

-- Seed initial data for Team Members
INSERT INTO team_members (name, role, bio, display_order, photo_url) VALUES
('Alex Chen', 'Founder & CEO', 'Visionary leader with over 15 years of experience in the tech industry. Passionate about innovation and building great teams.', 1, 'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=portrait%20of%20asian%20male%20tech%20ceo%20cyberpunk%20style%20neon%20lighting&image_size=square'),
('Sarah Jones', 'Creative Director', 'Award-winning designer with a keen eye for detail and a love for all things sci-fi. leads our creative vision.', 2, 'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=portrait%20of%20female%20creative%20director%20cyberpunk%20style%20neon%20lighting&image_size=square'),
('Mike Ross', 'Lead Developer', 'Full-stack wizard who loves solving complex problems. Expert in React, Node.js, and cloud architecture.', 3, 'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=portrait%20of%20male%20developer%20with%20glasses%20cyberpunk%20style%20neon%20lighting&image_size=square'),
('Emily Wang', 'Project Manager', 'The glue that holds everything together. Ensures projects are delivered on time and within budget.', 4, 'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=portrait%20of%20female%20project%20manager%20cyberpunk%20style%20neon%20lighting&image_size=square');
