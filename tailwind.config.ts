import type { Config } from "tailwindcss";

/** Every colour resolves through a CSS variable so a single token definition
 *  drives both appearances. `<alpha-value>` keeps opacity modifiers
 *  (`bg-primary/10`) working against the hsl() channels. */
const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
	darkMode: ["class"],
	content: [
		"./pages/**/*.{ts,tsx}",
		"./components/**/*.{ts,tsx}",
		"./app/**/*.{ts,tsx}",
		"./src/**/*.{ts,tsx}",
	],
	prefix: "",
	theme: {
		container: {
			center: true,
			padding: '2rem',
			screens: {
				'2xl': '1400px'
			}
		},
		extend: {
			fontFamily: {
				sans: ['var(--font-sans)'],
			},
			/* Apple's text styles, converted from pt to rem with their paired
			   leading and tracking. Larger sizes tighten; small sizes open up. */
			fontSize: {
				'caption2':   ['0.6875rem', { lineHeight: '0.8125rem', letterSpacing: '0.006em' }],
				'caption':    ['0.75rem',   { lineHeight: '1rem',      letterSpacing: '0em' }],
				'footnote':   ['0.8125rem', { lineHeight: '1.125rem',  letterSpacing: '-0.006em' }],
				'subheadline':['0.9375rem', { lineHeight: '1.25rem',   letterSpacing: '-0.01em' }],
				'callout':    ['1rem',      { lineHeight: '1.3125rem', letterSpacing: '-0.014em' }],
				'body':       ['1.0625rem', { lineHeight: '1.375rem',  letterSpacing: '-0.024em' }],
				'headline':   ['1.0625rem', { lineHeight: '1.375rem',  letterSpacing: '-0.024em', fontWeight: '600' }],
				'title3':     ['1.25rem',   { lineHeight: '1.5625rem', letterSpacing: '-0.026em' }],
				'title2':     ['1.375rem',  { lineHeight: '1.75rem',   letterSpacing: '-0.026em' }],
				'title1':     ['1.75rem',   { lineHeight: '2.125rem',  letterSpacing: '-0.026em' }],
				'large-title':['2.125rem',  { lineHeight: '2.5625rem', letterSpacing: '-0.028em' }],
			},
			colors: {
				border: token('border'),
				input: token('input'),
				ring: token('ring'),
				background: token('background'),
				foreground: token('foreground'),
				primary: {
					DEFAULT: token('primary'),
					foreground: token('primary-foreground')
				},
				secondary: {
					DEFAULT: token('secondary'),
					foreground: token('secondary-foreground')
				},
				destructive: {
					DEFAULT: token('destructive'),
					foreground: token('destructive-foreground')
				},
				/* Status colours belong in the token layer too — otherwise every
				   success/warning badge reaches for a hardcoded green or amber
				   that cannot adapt to dark mode. */
				success: {
					DEFAULT: token('success'),
					foreground: token('success-foreground')
				},
				warning: {
					DEFAULT: token('warning'),
					foreground: token('warning-foreground')
				},
				info: {
					DEFAULT: token('info'),
					foreground: token('info-foreground')
				},
				muted: {
					DEFAULT: token('muted'),
					foreground: token('muted-foreground')
				},
				accent: {
					DEFAULT: token('accent'),
					foreground: token('accent-foreground')
				},
				popover: {
					DEFAULT: token('popover'),
					foreground: token('popover-foreground')
				},
				card: {
					DEFAULT: token('card'),
					foreground: token('card-foreground')
				},
				chart: {
					1: token('chart-1'), 2: token('chart-2'), 3: token('chart-3'), 4: token('chart-4'),
					5: token('chart-5'), 6: token('chart-6'), 7: token('chart-7'), 8: token('chart-8')
				},
				sidebar: {
					DEFAULT: token('sidebar-background'),
					foreground: token('sidebar-foreground'),
					primary: token('sidebar-primary'),
					'primary-foreground': token('sidebar-primary-foreground'),
					accent: token('sidebar-accent'),
					'accent-foreground': token('sidebar-accent-foreground'),
					border: token('sidebar-border'),
					ring: token('sidebar-ring')
				}
			},
			borderRadius: {
				sm: 'calc(var(--radius) - 4px)',
				md: 'calc(var(--radius) - 2px)',
				lg: 'var(--radius)',
				xl: 'calc(var(--radius) + 4px)',
				'2xl': 'calc(var(--radius) + 8px)',
				'3xl': 'calc(var(--radius) + 16px)'
			},
			boxShadow: {
				xs: 'var(--shadow-xs)',
				sm: 'var(--shadow-sm)',
				DEFAULT: 'var(--shadow-sm)',
				md: 'var(--shadow-md)',
				lg: 'var(--shadow-lg)',
				xl: 'var(--shadow-xl)',
				'2xl': 'var(--shadow-xl)'
			},
			/* Apple's interface easing: quick to leave, slow to settle. */
			transitionTimingFunction: {
				'apple': 'cubic-bezier(0.32, 0.72, 0, 1)',
				'apple-in': 'cubic-bezier(0.4, 0, 1, 1)',
				'apple-out': 'cubic-bezier(0, 0, 0.2, 1)'
			},
			keyframes: {
				'accordion-down': {
					from: { height: '0' },
					to: { height: 'var(--radix-accordion-content-height)' }
				},
				'accordion-up': {
					from: { height: 'var(--radix-accordion-content-height)' },
					to: { height: '0' }
				},
				'fade-in': {
					from: { opacity: '0' },
					to: { opacity: '1' }
				},
				'slide-up': {
					from: { opacity: '0', transform: 'translateY(8px)' },
					to: { opacity: '1', transform: 'translateY(0)' }
				},
				'scale-in': {
					from: { opacity: '0', transform: 'scale(0.96)' },
					to: { opacity: '1', transform: 'scale(1)' }
				}
			},
			animation: {
				'accordion-down': 'accordion-down 0.2s cubic-bezier(0.32, 0.72, 0, 1)',
				'accordion-up': 'accordion-up 0.2s cubic-bezier(0.32, 0.72, 0, 1)',
				'fade-in': 'fade-in 0.2s cubic-bezier(0.32, 0.72, 0, 1)',
				'slide-up': 'slide-up 0.32s cubic-bezier(0.32, 0.72, 0, 1)',
				'scale-in': 'scale-in 0.2s cubic-bezier(0.32, 0.72, 0, 1)'
			}
		}
	},
	plugins: [require("tailwindcss-animate")],
} satisfies Config;
