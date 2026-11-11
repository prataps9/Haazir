import ScrollProgress from './components/ScrollProgress'
import Nav from './components/Nav'
import Hero from './components/Hero'
import SegmentBar from './components/SegmentBar'
import WhatItDoes from './components/WhatItDoes'
import Marketing from './components/Marketing'
import Loop from './components/Loop'
import Calculator from './components/Calculator'
import HowItWorks from './components/HowItWorks'
import Pricing from './components/Pricing'
import Faq from './components/Faq'
import CallToAction from './components/CallToAction'
import Footer from './components/Footer'

/**
 * Demo first. The thread now plays inside the hero, so the most persuasive
 * thing on the page is the first thing on it — rather than a stock photo up
 * top and the working demo a third of the way down, which is what this was.
 *
 * Show it → the half that replies → the half that brings people back → how
 * the two join up → price the alternative → explain the work → price the work →
 * answer the objections → ask.
 */
export default function App() {
  return (
    <>
      <ScrollProgress />
      <Nav />
      <Hero />
      <main>
        <SegmentBar />
        <WhatItDoes />
        <Marketing />
        <Loop />
        <Calculator />
        <HowItWorks />
        <Pricing />
        <Faq />
        <CallToAction />
      </main>
      <Footer />
    </>
  )
}
