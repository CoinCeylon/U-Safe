export default {
  content: [
    './index.html',
    './student/index.html',
    './university/index.html',
    './ugc/index.html',
    './src/**/*.{js,ts}',
    './src/**/*.html',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#0f766e',
        'primary-light': '#ccfbf1',
        'primary-dark': '#115e59',
        success: '#15803d',
        'success-light': '#dcfce7',
        warning: '#b45309',
        'warning-light': '#fef3c7',
        danger: '#b91c1c',
        'danger-light': '#fee2e2',
      },
    },
  },
  plugins: [],
};
