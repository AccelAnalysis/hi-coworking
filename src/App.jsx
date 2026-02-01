import React, { useState, useEffect } from 'react';
import { 
  ArrowRight, 
  Check, 
  MapPin, 
  Coffee, 
  Wifi, 
  Armchair, 
  Users, 
  Printer, 
  Mic, 
  Mail, 
  Calendar, 
  ChevronRight, 
  ChevronLeft,
  X,
  TrendingUp,
  Briefcase,
  Wallet
} from 'lucide-react';

// --- CONFIGURATION ---
// TODO: Deploy the Code.gs script as a Web App and paste the URL here
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx0dQdEndmNxRcPyvdmbOvh4GN49VI2v0qHxN3mmmpQhZj89xVV1bVqyb_1zOzrSLzD4g/exec"; 

// --- Components ---

const Button = ({ children, onClick, variant = 'primary', className = '', type = 'button', disabled = false }) => {
  const baseStyle = "inline-flex items-center justify-center px-6 py-3 rounded-full font-medium transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";
  
  // Updated for Glassmorphism & Gradient feels
  const variants = {
    primary: "bg-slate-900 text-white hover:bg-slate-800 hover:shadow-lg hover:shadow-slate-900/20 focus:ring-slate-900",
    secondary: "bg-white/80 backdrop-blur-sm text-slate-900 border border-slate-200 hover:bg-white hover:shadow-md focus:ring-slate-200",
    outline: "border-2 border-slate-900 text-slate-900 hover:bg-slate-50",
    ghost: "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
  };

  return (
    <button 
      type={type}
      onClick={onClick} 
      disabled={disabled}
      className={`${baseStyle} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
};

const Section = ({ children, className = '', id = '' }) => (
  <section id={id} className={`py-20 md:py-32 px-6 md:px-12 max-w-7xl mx-auto ${className}`}>
    {children}
  </section>
);

// Glassmorphism Card
const Card = ({ children, className = '' }) => (
  <div className={`bg-white/70 backdrop-blur-md p-8 rounded-2xl border border-white/50 shadow-xl shadow-slate-200/50 hover:shadow-2xl hover:shadow-slate-200/70 hover:-translate-y-1 transition-all duration-300 ${className}`}>
    {children}
  </div>
);

// --- Survey Data ---
const surveyQuestions = [
  {
    id: 1,
    question: "How do you currently work most days?",
    type: "single",
    options: ["From home", "From home, but I need a change", "Coffee shops / public spaces", "Client site / on the road", "Office outside immediate area", "Other"]
  },
  {
    id: 2,
    question: "How often would you realistically use a local coworking space?",
    type: "single",
    options: ["A few times per month", "About once per week", "2–3 days per week", "4–5 days per week", "Only occasionally"]
  },
  {
    id: 3,
    question: "What would be your primary reason for using Hi Coworking?",
    type: "multi-limit-2",
    options: ["Focus and productivity", "Separation from home", "Professional setting", "Reliable internet", "Networking", "Specific amenities"]
  },
  {
    id: 4,
    question: "Which of the following would you actually use?",
    type: "multi",
    options: ["Open desk seating", "Quiet / focus desks", "Small meeting room", "Phone / video call area", "Printing / scanning", "Mail handling", "Podcast setup", "Workshops"]
  },
  {
    id: 5,
    question: "When you’re working, which matters more to you?",
    type: "single",
    options: ["Quiet and minimal distractions", "Balance of quiet and light interaction", "Energy and conversation", "It depends on the day"]
  },
  {
    id: 6,
    question: "What makes a coworking space not worth using for you?",
    type: "multi-limit-2",
    options: ["Too loud / distracting", "Too expensive", "Hard to access", "Long-term commitments", "Overcrowded", "Poor internet"]
  },
  {
    id: 7,
    question: "How far would you be willing to travel to use a coworking space?",
    type: "single",
    options: ["Under 5 minutes", "5–10 minutes", "10–15 minutes", "15–25 minutes", "Only if I’m already there"]
  },
  {
    id: 8,
    question: "Which pricing style feels most reasonable?",
    type: "single",
    options: ["Half-day access", "Full-day access", "Multi-day packs", "Monthly (no contract)", "Pay-as-you-go"]
  },
  {
    id: 9,
    question: "If Hi Coworking opened tomorrow, what would make you try it?",
    type: "text",
    placeholder: "e.g., A free trial day, meeting other locals..."
  },
  {
    id: 10,
    question: "If you could design the perfect small workspace for your area, what would it include?",
    type: "text",
    placeholder: "e.g., specific coffee, standing desks..."
  }
];

// --- API Helper ---
const submitData = async (payload) => {
  if (!SCRIPT_URL) {
    console.warn("Script URL not set. Data would be:", payload);
    return new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Use 'no-cors' mode for Google Apps Script simple triggers
  // Note: response will be opaque, so we assume success if no network error
  try {
    await fetch(SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return true;
  } catch (e) {
    console.error("Submission failed", e);
    return false;
  }
};

// --- Main App Component ---

export default function App() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [surveyOpen, setSurveyOpen] = useState(false);
  
  // Early Access Form State
  const [formData, setFormData] = useState({ name: '', email: '', message: '', interests: [] });
  const [formStatus, setFormStatus] = useState('idle'); // idle, submitting, success, error

  // Handle scroll for sticky nav styling
  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = (id) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setFormStatus('submitting');
    
    await submitData({
      type: 'early_access',
      ...formData,
      timestamp: new Date().toISOString()
    });

    setFormStatus('success');
  };

  const toggleInterest = (interest) => {
    setFormData(prev => {
      const interests = prev.interests.includes(interest)
        ? prev.interests.filter(i => i !== interest)
        : [...prev.interests, interest];
      return { ...prev, interests };
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-emerald-200 selection:text-emerald-900 relative overflow-hidden">
      
      {/* Background Decorative Gradients */}
      <div className="fixed top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-200/20 blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-slate-300/20 blur-[120px] pointer-events-none" />

      {/* Navigation */}
      <nav className={`fixed w-full z-50 transition-all duration-300 ${isScrolled ? 'bg-white/80 backdrop-blur-md shadow-sm border-b border-white/20 py-4' : 'bg-transparent py-6'}`}>
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex justify-between items-center">
          <div className="font-bold text-xl tracking-tight flex items-center gap-2">
            <div className="w-8 h-8 bg-slate-900 rounded-2xl rounded-bl-none flex items-center justify-center text-white text-sm font-bold shadow-lg shadow-slate-900/20">Hi</div>
            <span>Coworking</span>
          </div>
          <div className="hidden md:flex gap-8 text-sm font-medium text-slate-600">
            <button onClick={() => scrollToSection('concept')} className="hover:text-slate-900 transition-colors">Concept</button>
            <button onClick={() => scrollToSection('impact')} className="hover:text-slate-900 transition-colors">Local Impact</button>
            <button onClick={() => scrollToSection('community')} className="hover:text-slate-900 transition-colors">Community</button>
          </div>
          <Button onClick={() => scrollToSection('access')} variant={isScrolled ? 'primary' : 'secondary'} className="px-5 py-2 text-sm">
            Get Early Access
          </Button>
        </div>
      </nav>

      {/* Hero Section */}
      <header className="pt-32 pb-20 md:pt-48 md:pb-32 px-6 relative z-10">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/50 backdrop-blur-sm text-emerald-800 text-xs font-semibold tracking-wide uppercase border border-emerald-100 shadow-sm">
            <MapPin size={12} /> Coming Soon
          </div>
          <h1 className="text-5xl md:text-8xl font-bold tracking-tight text-slate-900 leading-[1.1] drop-shadow-sm">
            Big ideas.<br />
            <span className="text-slate-400">Intimate space.</span>
          </h1>
          <p className="text-xl md:text-2xl text-slate-600 max-w-2xl mx-auto leading-relaxed font-light">
            A micro-coworking space designed for focus, flexibility, and real local use—not massive floors or long contracts.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-8">
            <Button onClick={() => scrollToSection('access')} className="group shadow-xl shadow-slate-900/10">
              Get Early Access <ArrowRight size={18} className="ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
            <Button onClick={() => setSurveyOpen(true)} variant="secondary" className="shadow-lg shadow-slate-200/50">
              Shape the Space
            </Button>
          </div>
        </div>
      </header>

      {/* Concept Section */}
      <Section id="concept">
        <div className="grid md:grid-cols-2 gap-16 items-center">
          <div className="space-y-6">
            <h2 className="text-3xl md:text-4xl font-bold">What is a Micro-Coworking Space?</h2>
            <p className="text-lg text-slate-600 leading-relaxed">
              It’s intentionally small. Instead of hundreds of desks and constant noise, Hi Coworking offers a calm, efficient workspace built around how people actually work today.
            </p>
            <ul className="space-y-4 pt-4">
              {[
                "Fewer desks, less distraction",
                "Short-term and flexible use",
                "Professional environment, no overhead",
                "Space designed for productivity, not spectacle"
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-3 text-slate-700">
                  <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 shadow-sm">
                    <Check size={14} strokeWidth={3} />
                  </div>
                  {item}
                </li>
              ))}
            </ul>
            <div className="pt-4 font-medium text-slate-900 italic">
              "Big ideas don’t require big buildings."
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-4 translate-y-8">
              <Card className="bg-slate-50/50 border-0">
                <div className="text-3xl mb-2 grayscale opacity-50">🚫</div>
                <div className="font-semibold text-slate-400 line-through">Massive Floors</div>
              </Card>
              <Card className="bg-slate-900 text-white border-0 !shadow-slate-900/30">
                <div className="text-3xl mb-2">✨</div>
                <div className="font-semibold">Calm Focus</div>
              </Card>
            </div>
            <div className="space-y-4">
              <Card className="bg-emerald-50/50 border-emerald-100/50">
                <div className="text-3xl mb-2">📍</div>
                <div className="font-semibold text-emerald-900">Local Use</div>
              </Card>
              <Card className="bg-slate-50/50 border-0">
                <div className="text-3xl mb-2 grayscale opacity-50">🚫</div>
                <div className="font-semibold text-slate-400 line-through">Long Contracts</div>
              </Card>
            </div>
          </div>
        </div>
      </Section>

      {/* Who It's For */}
      <Section>
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold mb-4">Who Hi Coworking Is For</h2>
          <p className="text-slate-600">If any of this sounds familiar, you’re in the right place.</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { icon: Wifi, title: "Remote Workers", desc: "Need separation from home to actually get things done." },
            { icon: Briefcase, title: "Small Business", desc: "Owners who don't need a full office lease." },
            { icon: Users, title: "Consultants", desc: "Analysts, creatives, and builders who value focus." },
            { icon: MapPin, title: "Locals", desc: "People who want a workspace nearby—not a commute." },
          ].map((card, i) => (
            <Card key={i} className="group hover:border-emerald-200/50">
              <card.icon className="w-10 h-10 text-slate-400 group-hover:text-emerald-600 transition-colors mb-4" />
              <h3 className="font-bold text-lg mb-2">{card.title}</h3>
              <p className="text-slate-600 text-sm leading-relaxed">{card.desc}</p>
            </Card>
          ))}
        </div>
      </Section>

      {/* NEW: Economic Development / Local Impact Section */}
      <Section id="impact" className="relative">
         {/* Background accent for this section */}
         <div className="absolute inset-0 bg-slate-50 skew-y-3 transform origin-top-left -z-10" />
         
         <div className="max-w-4xl mx-auto">
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-800 text-xs font-semibold tracking-wide uppercase border border-blue-100 mb-6">
                <TrendingUp size={12} /> Why This Matters Locally
              </div>
              <h2 className="text-3xl md:text-4xl font-bold mb-6">More Than Just Desks</h2>
              <p className="text-slate-600 text-lg">
                Hi Coworking isn't just about office space. It's about building infrastructure for the local economy.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              {[
                { 
                  icon: Users, 
                  title: "Talent Retention", 
                  text: "Keeping skilled professionals in our community instead of losing them to daily commutes." 
                },
                { 
                  icon: Briefcase, 
                  title: "Small Biz Enablement", 
                  text: "Giving founders and freelancers a professional base to grow without high overhead." 
                },
                { 
                  icon: Wallet, 
                  title: "Local Spending", 
                  text: "Reducing commute leakage means lunch, coffee, and errands happen here, not miles away." 
                }
              ].map((item, i) => (
                <div key={i} className="text-center p-6 rounded-2xl bg-white/40 border border-white/60 backdrop-blur-sm hover:bg-white/60 transition-colors">
                  <div className="w-12 h-12 bg-white rounded-xl shadow-lg shadow-slate-200/50 text-slate-900 flex items-center justify-center mx-auto mb-4">
                    <item.icon size={24} />
                  </div>
                  <h3 className="font-bold text-lg mb-2 text-slate-900">{item.title}</h3>
                  <p className="text-slate-600 text-sm leading-relaxed">{item.text}</p>
                </div>
              ))}
            </div>
         </div>
      </Section>

      {/* What We're Building */}
      <Section className="bg-slate-900 text-white rounded-[2.5rem] relative overflow-hidden my-12 shadow-2xl shadow-slate-900/20">
        {/* Abstract shapes for visual interest */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-emerald-500/10 blur-[100px] rounded-full pointer-events-none" />
        
        <div className="relative z-10">
          <div className="md:flex justify-between items-end mb-12 border-b border-slate-800 pb-8">
            <div className="max-w-xl">
              <h2 className="text-3xl font-bold mb-4">What We’re Building (Together)</h2>
              <p className="text-slate-400">
                Hi Coworking will open in phases. Some services launch immediately. Others will be added based on real interest and local demand.
              </p>
            </div>
            <div className="hidden md:block text-right">
              <div className="text-sm text-slate-500 uppercase tracking-wider font-semibold mb-1">Status</div>
              <div className="flex items-center gap-2 text-emerald-400 font-medium">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </span>
                Finalizing Layout
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-12">
            {/* Day One */}
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="bg-white/10 p-2 rounded-lg backdrop-blur-sm">
                  <Check className="text-white w-5 h-5" />
                </div>
                <h3 className="text-xl font-bold">Core Workspace (Day One)</h3>
              </div>
              <ul className="space-y-4 pl-4 border-l border-slate-800">
                {[
                  "Flexible desk seating",
                  "Half-day and full-day access",
                  "Fast, reliable internet",
                  "Quiet-first layout",
                  "Clean, professional environment"
                ].map((item, i) => (
                  <li key={i} className="text-slate-300 flex items-center gap-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Based on Interest */}
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="bg-white/10 p-2 rounded-lg backdrop-blur-sm">
                  <Users className="text-white w-5 h-5" />
                </div>
                <h3 className="text-xl font-bold">Possible Add-Ons (Vote)</h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { icon: Coffee, label: "Private Focus Desks" },
                  { icon: Users, label: "Small Meeting Room" },
                  { icon: Mic, label: "Podcast Setup" },
                  { icon: Printer, label: "Printing & Scan" },
                  { icon: Mail, label: "Mail Address" },
                  { icon: Calendar, label: "Workshops" },
                ].map((item, i) => (
                  <div key={i} className="bg-white/5 hover:bg-white/10 transition-colors p-4 rounded-xl border border-white/5 flex items-center gap-3 text-sm text-slate-300 cursor-default">
                    <item.icon className="w-4 h-4 text-slate-500" />
                    {item.label}
                  </div>
                ))}
              </div>
              <p className="mt-6 text-sm text-slate-500 italic">
                "We’re building the right things—not the most things."
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* Survey Callout */}
      <Section id="community">
        <div className="bg-emerald-50/50 backdrop-blur-md rounded-2xl p-8 md:p-12 text-center max-w-4xl mx-auto border border-emerald-100 shadow-xl shadow-emerald-100/50">
          <h2 className="text-2xl md:text-3xl font-bold text-emerald-950 mb-4">Help Shape the Space</h2>
          <p className="text-emerald-800 mb-8 max-w-2xl mx-auto">
            Hi Coworking isn’t being designed in a vacuum. Before opening, we’re collecting input from the people who will actually use the space.
          </p>
          <Button onClick={() => setSurveyOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white border-transparent shadow-lg shadow-emerald-600/20">
            Take the 2-Minute Survey
          </Button>
          <p className="mt-4 text-xs text-emerald-700 uppercase tracking-wide font-semibold">
            👉 Short survey. Real influence.
          </p>
        </div>
      </Section>

      {/* Early Access Form */}
      <Section id="access" className="border-t border-slate-200">
        <div className="max-w-xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold mb-4">Get Early Access</h2>
            <p className="text-slate-600">
              Be the first to know when Hi Coworking opens—and help shape what it becomes.
            </p>
          </div>

          {formStatus === 'success' ? (
             <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-8 text-center animate-in fade-in slide-in-from-bottom-4">
                <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Check size={32} />
                </div>
                <h3 className="text-xl font-bold text-emerald-900 mb-2">You're on the list!</h3>
                <p className="text-emerald-700">Thanks for joining. We'll be in touch soon with launch updates.</p>
                <Button variant="ghost" onClick={() => setFormStatus('idle')} className="mt-6">Submit another</Button>
             </div>
          ) : (
            <Card>
              <form className="space-y-6" onSubmit={handleFormSubmit}>
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Name</label>
                    <input 
                      required
                      type="text" 
                      value={formData.name}
                      onChange={e => setFormData({...formData, name: e.target.value})}
                      className="w-full px-4 py-3 rounded-lg border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all" 
                      placeholder="Jane Doe" 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Email</label>
                    <input 
                      required
                      type="email" 
                      value={formData.email}
                      onChange={e => setFormData({...formData, email: e.target.value})}
                      className="w-full px-4 py-3 rounded-lg border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all" 
                      placeholder="jane@example.com" 
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-sm font-medium text-slate-700">I’m interested in...</label>
                  <div className="grid grid-cols-2 gap-3">
                    {['Desk access', 'Meeting space', 'Business address', 'Podcast / Recording', 'Events'].map((opt) => (
                      <label key={opt} className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${formData.interests.includes(opt) ? 'bg-slate-50 border-slate-900' : 'border-slate-100 hover:bg-slate-50'}`}>
                        <input 
                          type="checkbox" 
                          checked={formData.interests.includes(opt)}
                          onChange={() => toggleInterest(opt)}
                          className="w-4 h-4 text-slate-900 rounded border-slate-300 focus:ring-slate-900" 
                        />
                        <span className="text-sm text-slate-700">{opt}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Optional Message</label>
                  <textarea 
                    rows={3} 
                    value={formData.message}
                    onChange={e => setFormData({...formData, message: e.target.value})}
                    className="w-full px-4 py-3 rounded-lg border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all" 
                    placeholder="What would you like to see in a coworking space here?" 
                  />
                </div>

                <Button className="w-full" type="submit" disabled={formStatus === 'submitting'}>
                  {formStatus === 'submitting' ? 'Joining...' : 'Join the Early Access List'}
                </Button>
                <p className="text-center text-xs text-slate-400 mt-4">
                  No spam. Just launch updates and early booking invitations.
                </p>
              </form>
            </Card>
          )}
        </div>
      </Section>

      {/* Footer */}
      <footer className="bg-white/50 backdrop-blur-md py-12 border-t border-slate-200 text-center relative z-10">
        <div className="max-w-7xl mx-auto px-6">
          <h3 className="font-bold text-lg mb-4">Hi Coworking</h3>
          <p className="text-slate-500 mb-8 max-w-md mx-auto">
            Big ideas. Intimate space. Local focus.<br/>
            A small workspace—built intentionally for the way work actually happens.
          </p>
          <div className="flex justify-center gap-6 text-sm text-slate-400">
            <a href="#" className="hover:text-slate-900 transition-colors">Contact Us</a>
            <a href="#" className="hover:text-slate-900 transition-colors">Twitter</a>
            <a href="#" className="hover:text-slate-900 transition-colors">Instagram</a>
          </div>
          <p className="mt-8 text-xs text-slate-300">
            © {new Date().getFullYear()} Hi Coworking. All rights reserved.
          </p>
        </div>
      </footer>

      {/* Survey Modal */}
      {surveyOpen && <SurveyModal onClose={() => setSurveyOpen(false)} />}
    </div>
  );
}

// --- Survey Modal Component ---

const SurveyModal = ({ onClose }) => {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);

  const currentQ = surveyQuestions[step];
  const progress = ((step + 1) / surveyQuestions.length) * 100;

  const handleOptionClick = (option) => {
    if (currentQ.type === 'single') {
      setAnswers({ ...answers, [currentQ.id]: option });
      setTimeout(nextStep, 250);
    } else {
      // Multi select logic
      const current = answers[currentQ.id] || [];
      if (current.includes(option)) {
        setAnswers({ ...answers, [currentQ.id]: current.filter(i => i !== option) });
      } else {
        setAnswers({ ...answers, [currentQ.id]: [...current, option] });
      }
    }
  };

  const handleTextChange = (e) => {
    setAnswers({ ...answers, [currentQ.id]: e.target.value });
  };

  const nextStep = () => {
    if (step < surveyQuestions.length - 1) {
      setStep(step + 1);
    } else {
      finishSurvey();
    }
  };

  const prevStep = () => {
    if (step > 0) setStep(step - 1);
  };

  const finishSurvey = async () => {
    setIsSubmitting(true);
    
    // Send data to Google Sheets
    await submitData({
      type: 'survey',
      answers,
      timestamp: new Date().toISOString()
    });

    setCompleted(true);
    setIsSubmitting(false);
  };

  if (completed) {
    return (
      <div className="fixed inset-0 z-[60] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-white/90 backdrop-blur-md rounded-2xl w-full max-w-lg p-12 text-center animate-in fade-in zoom-in duration-300 shadow-2xl">
          <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <Check size={32} />
          </div>
          <h3 className="text-2xl font-bold mb-4">Thank You!</h3>
          <p className="text-slate-600 mb-8">
            Your input directly shapes what we build. We've recorded your preferences.
          </p>
          <Button onClick={onClose} className="w-full">Back to Site</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white/95 backdrop-blur-xl rounded-2xl w-full max-w-xl h-[600px] flex flex-col shadow-2xl animate-in slide-in-from-bottom-10 duration-300 relative overflow-hidden border border-white/20">
        
        {/* Header */}
        <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-white/50">
          <div>
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Question {step + 1} of {surveyQuestions.length}</span>
            <div className="w-32 h-1 bg-slate-100 rounded-full mt-2 overflow-hidden">
              <div className="h-full bg-slate-900 transition-all duration-500 ease-out" style={{ width: `${progress}%` }}></div>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Question Body */}
        <div className="flex-1 overflow-y-auto p-8">
          <h3 className="text-2xl font-bold text-slate-900 mb-8 leading-tight">
            {currentQ.question}
          </h3>

          <div className="space-y-3">
            {currentQ.options && currentQ.options.map((opt) => {
              const isSelected = 
                currentQ.type === 'single' 
                  ? answers[currentQ.id] === opt
                  : (answers[currentQ.id] || []).includes(opt);

              return (
                <button
                  key={opt}
                  onClick={() => handleOptionClick(opt)}
                  className={`w-full text-left px-5 py-4 rounded-xl border transition-all duration-200 flex items-center justify-between group
                    ${isSelected 
                      ? 'border-slate-900 bg-slate-50/80 ring-1 ring-slate-900' 
                      : 'border-slate-200 hover:border-slate-400 hover:bg-slate-50'}`}
                >
                  <span className={`font-medium ${isSelected ? 'text-slate-900' : 'text-slate-600'}`}>{opt}</span>
                  {isSelected && <Check size={18} className="text-slate-900" />}
                </button>
              );
            })}

            {currentQ.type === 'text' && (
              <textarea
                autoFocus
                value={answers[currentQ.id] || ''}
                onChange={handleTextChange}
                placeholder={currentQ.placeholder}
                className="w-full p-4 rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 outline-none h-40 resize-none text-lg bg-white/50"
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 py-6 border-t border-slate-100 flex justify-between items-center bg-white/50">
          <button 
            onClick={prevStep} 
            disabled={step === 0}
            className={`flex items-center gap-2 text-sm font-medium transition-colors ${step === 0 ? 'text-slate-300 cursor-not-allowed' : 'text-slate-500 hover:text-slate-900'}`}
          >
            <ChevronLeft size={16} /> Previous
          </button>

          <Button onClick={nextStep} className="px-6 py-2">
            {step === surveyQuestions.length - 1 ? (isSubmitting ? 'Sending...' : 'Finish') : 'Next'}
            {!isSubmitting && step !== surveyQuestions.length - 1 && <ChevronRight size={16} className="ml-1" />}
          </Button>
        </div>

      </div>
    </div>
  );
};