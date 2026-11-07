(() => {
  'use strict';

  const intro = document.getElementById('intro');
  const skipIntro = document.getElementById('skipIntro');
  const landing = document.getElementById('landing');
  const particles = document.getElementById('introParticles');
  const backgrounds = [...document.querySelectorAll('.scenery-image')];
  const dots = [...document.querySelectorAll('.slide-dot')];
  const slideCount = document.getElementById('slideCount');
  const slideDescription = document.getElementById('slideDescription');
  const descriptions = ['Лесные дороги', 'Деревенская улица', 'Вечер у реки'];
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');

  let introFinished = false;
  let introTimeout;
  let slideTimeout;
  let currentSlide = 0;
  landing.inert = true;

  // Tiny firefly-like points are confined to the startup animation.
  if (!motionPreference.matches && particles) {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 34; i += 1) {
      const point = document.createElement('span');
      const x = 7 + Math.random() * 86;
      const y = 8 + Math.random() * 82;
      point.style.setProperty('--x', x.toFixed(2) + '%');
      point.style.setProperty('--y', y.toFixed(2) + '%');
      point.style.setProperty('--size', (1 + Math.random() * 2.2).toFixed(1) + 'px');
      point.style.setProperty('--duration', (2.3 + Math.random() * 2.6).toFixed(2) + 's');
      point.style.setProperty('--delay', (Math.random() * 2.1).toFixed(2) + 's');
      point.style.setProperty('--drift', ((Math.random() - .5) * 55).toFixed(1) + 'px');
      fragment.append(point);
    }
    particles.append(fragment);
  }

  function stopSlideTimer() {
    window.clearTimeout(slideTimeout);
    slideTimeout = undefined;
  }

  function scheduleSlide() {
    stopSlideTimer();
    if (motionPreference.matches || document.hidden || !introFinished) return;
    slideTimeout = window.setTimeout(() => showSlide(currentSlide + 1), 7000);
  }

  function showSlide(nextIndex) {
    currentSlide = (nextIndex + backgrounds.length) % backgrounds.length;
    backgrounds.forEach((background, index) => {
      background.classList.toggle('scenery-image--active', index === currentSlide);
    });
    dots.forEach((dot, index) => {
      const selected = index === currentSlide;
      // Reinsert the active state so its progress bar always starts at zero.
      dot.classList.remove('is-current');
      dot.removeAttribute('aria-current');
      if (selected) {
        void dot.offsetWidth;
        dot.classList.add('is-current');
        dot.setAttribute('aria-current', 'true');
      }
    });
    slideCount.innerHTML = String(currentSlide + 1).padStart(2, '0') + ' <span>/ 03</span>';
    slideDescription.textContent = descriptions[currentSlide];
    scheduleSlide();
  }

  function finishIntro() {
    if (introFinished) return;
    introFinished = true;
    window.clearTimeout(introTimeout);
    landing.removeAttribute('aria-hidden');
    landing.inert = false;
    landing.classList.add('is-visible');
    intro.classList.add('is-exiting');
    skipIntro.disabled = true;
    window.setTimeout(() => {
      intro.hidden = true;
      intro.remove();
    }, motionPreference.matches ? 0 : 1000);
    scheduleSlide();
  }

  // The intro is intentionally short and always skippable.
  skipIntro.addEventListener('click', finishIntro);
  if (motionPreference.matches) {
    finishIntro();
  } else {
    introTimeout = window.setTimeout(finishIntro, 3150);
  }

  dots.forEach(dot => {
    dot.addEventListener('click', () => showSlide(Number(dot.dataset.go)));
  });
  document.getElementById('previousScene').addEventListener('click', () => showSlide(currentSlide - 1));
  document.getElementById('nextScene').addEventListener('click', () => showSlide(currentSlide + 1));

  // Continue the slideshow when visitors return to the tab.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopSlideTimer();
    else scheduleSlide();
  });

  // Natural swipe navigation for phones, ignoring mostly vertical movements.
  let touchStart = null;
  landing.addEventListener('touchstart', event => {
    if (event.touches.length !== 1) return;
    touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }, { passive: true });
  landing.addEventListener('touchend', event => {
    if (!touchStart || event.changedTouches.length !== 1) return;
    const deltaX = event.changedTouches[0].clientX - touchStart.x;
    const deltaY = event.changedTouches[0].clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(deltaX) >= 75 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) {
      showSlide(currentSlide + (deltaX < 0 ? 1 : -1));
    }
  }, { passive: true });

  // Preload the next images so fades stay smooth on slower connections.
  ['./assets/village-road.webp', './assets/riverside.webp'].forEach(source => {
    const photo = new Image();
    photo.src = source;
  });
})();
