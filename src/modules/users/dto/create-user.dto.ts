import { Equals, IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @MinLength(8, { message: 'A senha deve ter pelo menos 8 caracteres' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'A senha deve conter pelo menos uma letra e um número',
  })
  password: string;

  @MinLength(8, { message: 'A confirmação de senha deve ter pelo menos 8 caracteres' })
  confirmPassword: string;

  // Aceite dos Termos de Uso + Política de Privacidade juntos (spec
  // consentimento-privacidade.md — um par cobre os dois documentos). Só
  // `true` passa; ausente, `false`, ou qualquer outro valor é 400 e a conta
  // não é criada — a garantia fica no backend, não na confiança de que a
  // tela sempre manda o campo.
  @Equals(true, { message: 'É preciso aceitar os Termos de Uso e a Política de Privacidade' })
  legalTermsAccepted: boolean;
}