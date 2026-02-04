import Hero from '../components/home/Hero';
import FeaturedProjects from '../components/home/FeaturedProjects';
import Services from '../components/home/Services';

const Home = () => {
  return (
    <div className="min-h-screen">
      <Hero />
      <FeaturedProjects />
      <Services />
    </div>
  );
};

export default Home;
