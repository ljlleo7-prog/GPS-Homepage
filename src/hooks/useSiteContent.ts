import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface SiteContent {
  contact_address_line1: string;
  contact_address_line2: string;
  contact_email_primary: string;
  contact_email_support: string;
  contact_email_full: string;
  contact_phone_main: string;
  contact_hours: string;
  social_github: string;
  social_twitter: string;
  social_linkedin: string;
  [key: string]: string;
}

const defaultContent: SiteContent = {
  contact_address_line1: '123 Tech Avenue',
  contact_address_line2: 'Silicon Valley, CA 94025',
  contact_email_primary: 'hello@gps.studio',
  contact_email_support: 'support@gps.studio',
  contact_email_full: 'hello@geeksproductionstudio.com',
  contact_phone_main: '+1 (555) 123-4567',
  contact_hours: 'Mon-Fri, 9am-6pm PST',
  social_github: 'https://github.com/geeksproductionstudio',
  social_twitter: 'https://twitter.com/geeksprodstudio',
  social_linkedin: 'https://linkedin.com/company/geeksproductionstudio',
};

export const useSiteContent = () => {
  const [content, setContent] = useState<SiteContent>(defaultContent);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchContent = async () => {
      try {
        const { data, error } = await supabase
          .from('site_content')
          .select('key, content');

        if (error) {
          // If the table doesn't exist yet, we'll just stick with defaultContent
          console.warn('Could not fetch site content (table might be missing):', error.message);
          return;
        }

        if (data && data.length > 0) {
          const newContent = data.reduce((acc, item) => {
            acc[item.key] = item.content;
            return acc;
          }, { ...defaultContent });
          setContent(newContent);
        }
      } catch (err) {
        console.error('Error in useSiteContent:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchContent();
  }, []);

  return { content, loading };
};
