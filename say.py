import sys
from io import StringIO
from cowsay import read_dot_cow, cowthink

cow = read_dot_cow(StringIO("""
$the_cow = <<EOC;
         $thoughts
          $thoughts
           ___
          (o o)
         (  V  )
        /--m-m-
EOC
"""))

def say_message(message):
    print(cowthink(message, cowfile=cow))

def ask_authorization(question):
    print("\n\033[1;36m╔══ Authorization Request ══╗\033[0m")
    print(f"\033[1;36m║\033[0m {question}\033[1;36m ║\033[0m")
    print("\033[1;36m╚════════════════════════════╝\033[0m")
    return input("\033[1;33m→ Proceed? [y/N]: \033[0m")

if __name__ == "__main__":
    message = sys.argv[1] if len(sys.argv) > 1 else ""
    say_message(message)