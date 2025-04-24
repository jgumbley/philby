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

message = sys.argv[1] if len(sys.argv) > 1 else ""

print(cowthink(message, cowfile=cow))
