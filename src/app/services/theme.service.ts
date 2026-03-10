/**
 * ThemeService — maps archetype color keywords to CSS custom properties.
 *
 * Each archetype gets a signature color (gold, teal, rose, emerald, amber).
 * setTheme() is called once after profile generation, writing 4 CSS vars
 * onto document.documentElement so the entire app adapts:
 *   --accent-primary  → main accent color
 *   --accent-glow     → glow/shadow effects (40% opacity)
 *   --accent-soft     → subtle backgrounds (12% opacity)
 *   --accent-text     → text tinted with the accent
 *
 * The base dark theme (backgrounds, fonts, spacing) is in styles.scss — NOT here.
 * This service only controls the accent color layer.
 */
import { Injectable } from '@angular/core';

export interface ThemeColors {
  primary: string;
  glow: string;
  soft: string;
  text: string;
}

// Color palettes per archetype keyword. Add new archetypes here.
const THEMES: Record<string, ThemeColors> = {
  gold: { primary: '#D4A843', glow: 'rgba(212,168,67,0.4)', soft: 'rgba(212,168,67,0.12)', text: '#F5E6C8' },
  teal: { primary: '#2A9D8F', glow: 'rgba(42,157,143,0.4)', soft: 'rgba(42,157,143,0.12)', text: '#C8F0EA' },
  rose: { primary: '#D4728C', glow: 'rgba(212,114,140,0.4)', soft: 'rgba(212,114,140,0.12)', text: '#F5D0DA' },
  emerald: { primary: '#50C878', glow: 'rgba(80,200,120,0.4)', soft: 'rgba(80,200,120,0.12)', text: '#C8F0D4' },
  amber: { primary: '#E09F3E', glow: 'rgba(224,159,62,0.4)', soft: 'rgba(224,159,62,0.12)', text: '#F5E0B8' },
};

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private currentTheme = 'gold';

  setTheme(colorKeyword: string): void {
    this.currentTheme = colorKeyword || 'gold';
    const colors = THEMES[this.currentTheme] || THEMES['gold'];
    const root = document.documentElement;
    root.style.setProperty('--accent-primary', colors.primary);
    root.style.setProperty('--accent-glow', colors.glow);
    root.style.setProperty('--accent-soft', colors.soft);
    root.style.setProperty('--accent-text', colors.text);
  }

  getColors(): ThemeColors {
    return THEMES[this.currentTheme] || THEMES['gold'];
  }
}
