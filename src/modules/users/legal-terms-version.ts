// Versão do PAR Termos de Uso + Política de Privacidade que o app exige
// aceite (os dois são aceitos juntos, um par, não dois pares — ver spec
// consentimento-privacidade.md, seção "Stack"). Bumpar esta string invalida
// o consentimento de TODA a base (legalTermsAccepted recomputa para false
// até reaceitar) — sem migração, sem db push.
//
// DEVE bater com a data no cabeçalho ("**Versão:**") dos DOIS arquivos em
// oratio/docs/legal/ — oratio/docs/legal/<data>-termos-de-uso.md e
// oratio/docs/legal/<data>-politica-de-privacidade.md. Publicar o texto
// noutro dia = criar os dois arquivos novos com a data nova e bumpar esta
// constante para a mesma data, no mesmo PR ou num PR pareado. Repos
// diferentes, sem CI compartilhado: o bump é manual dos dois lados.
export const LEGAL_TERMS_VERSION = '2026-09-11';
