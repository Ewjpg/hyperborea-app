// Где на компьютере лежит сайт HYPERBOREA (исходная папка, из которой собирается приложение).
// Другую папку можно задать переменной окружения HYPERBOREA_SITE.
export const SITE_DIR = process.env.HYPERBOREA_SITE
  ?? 'C:/Users/stark/Documents/ChatGPT/hyper/sites/hyperborea-azure-latch/public';
