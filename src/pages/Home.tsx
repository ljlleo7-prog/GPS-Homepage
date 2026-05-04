import Hero from '../components/home/Hero';
import FeaturedProjects from '../components/home/FeaturedProjects';
import Services from '../components/home/Services';
import WelcomeBackNotice from '../components/home/WelcomeBackNotice';
import WeeklyCommunitySnapshot from '../components/home/WeeklyCommunitySnapshot';
import QuickPollCard from '../components/home/QuickPollCard';
import CommunityActivityFeed from '../components/home/CommunityActivityFeed';

const Home = () => {
  return (
    <div className="min-h-screen">
      <Hero />
      <WelcomeBackNotice />
      <WeeklyCommunitySnapshot />
      <QuickPollCard />
      <CommunityActivityFeed />
      <FeaturedProjects />
      <Services />
    </div>
  );
};

export default Home;
